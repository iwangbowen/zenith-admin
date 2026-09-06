/**
 * 会话回放服务：分片 ingest（首分片 upsert 会话）、列表/详情查询、
 * 分片拉流、僵尸会话收尾与保留清理。
 *
 * 设计要点：
 * - 回放会话 ID 由客户端生成（UUID），(replayId, seq) 唯一 → 分片重传幂等；
 * - 分片二进制（rrweb events JSON.gz）bytea 直存，删除与元数据事务一致；
 * - startedAt/fromTs/toTs 为客户端时钟（与 rrweb 事件时间戳同源），
 *   lastActivityAt 为服务端时钟（僵尸收尾判定不信任客户端）。
 */
import { and, eq, desc, or, sql, inArray, lt, gte } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { gzipSync } from 'node:zlib';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { replaySessions, replaySegments, replayClickPoints, replayAccessLogs, errorEvents, analyticsSettings, userEvents } from '../../db/schema';
import type { ReplaySessionRow, ReplaySegmentRow } from '../../db/schema';
import type { ReplaySegmentUploadMetaInput } from '@zenith/shared/analytics';
import { currentUserOrNull } from '../../lib/context';
import { currentMemberOrNull } from '../../lib/member-context';
import { tenantScope, getCreateTenantId, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { parseClientEnv, resolveIngestPlatformFields } from '../../lib/analytics-helpers';
import { isSiteOriginAllowed, resolveSiteByKey } from './analytics-sites.service';

/** 单分片 gz 上限（防滥用；rrweb 10s 分片 gz 后通常 <200KB） */
export const REPLAY_SEGMENT_MAX_BYTES = 2 * 1024 * 1024;
/** 单会话分片数上限（10s/片 ≈ 100 分钟） */
const REPLAY_MAX_SEGMENTS = 600;
/** recording 会话无活动超时（服务端收尾判定） */
const REPLAY_STALE_MINUTES = 10;
/** 用量缓存 TTL：配额是软限制，30s 精度足够，避免每分片 SUM */
const USAGE_CACHE_TTL_MS = 30_000;
/** 滚动淘汰目标水位（清到配额的 90%，滞回防抖动） */
const QUOTA_LOW_WATERMARK = 0.9;
/** 硬顶：清理跟不上时拒收采样录制（错误触发不受限） */
const QUOTA_HARD_LIMIT = 1.2;

export interface ReplayReqCtx { ua: string; siteKey?: string | null; origin?: string | null }

export function mapReplaySession(row: ReplaySessionRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    mode: row.mode,
    status: row.status,
    triggers: row.triggers ?? [],
    startedAt: formatDateTime(row.startedAt),
    lastActivityAt: formatDateTime(row.lastActivityAt),
    endedAt: formatNullableDateTime(row.endedAt),
    durationMs: row.durationMs,
    segmentCount: row.segmentCount,
    totalBytes: row.totalBytes,
    errorCount: row.errorCount,
    pageCount: row.pageCount,
    clickCount: row.clickCount,
    pagePaths: row.pagePaths ?? [],
    clickLabels: row.clickLabels ?? [],
    entryPageUrl: row.entryPageUrl,
    source: row.source,
    appId: row.appId,
    environment: row.environment,
    userId: row.userId,
    username: row.username,
    memberId: row.memberId,
    browser: row.browser,
    os: row.os,
    deviceType: row.deviceType,
    sdkVersion: row.sdkVersion,
    createdAt: formatDateTime(row.createdAt),
  };
}

function mapSegmentMeta(row: Omit<ReplaySegmentRow, 'data'>) {
  return {
    id: row.id,
    replayId: row.replayId,
    seq: row.seq,
    fromTs: formatDateTime(row.fromTs),
    toTs: formatDateTime(row.toTs),
    byteSize: row.byteSize,
    eventCount: row.eventCount,
    hasFullSnapshot: row.hasFullSnapshot,
  };
}

// ─── ingest ──────────────────────────────────────────────────────────────────
/**
 * 接收一个回放分片：首分片 upsert 会话行，后续分片累加聚合。
 * 幂等：(replayId, seq) 冲突时丢弃重复分片（不重复累加聚合）。
 */
export async function ingestReplaySegment(meta: ReplaySegmentUploadMetaInput, data: Buffer, reqCtx: ReplayReqCtx): Promise<void> {
  if (data.byteLength === 0) throw new HTTPException(400, { message: '分片数据为空' });
  if (data.byteLength > REPLAY_SEGMENT_MAX_BYTES) throw new HTTPException(400, { message: '分片超出大小上限' });
  if (meta.toTs < meta.fromTs) throw new HTTPException(400, { message: '分片时间范围非法' });
  // 终包（pagehide）为规避页面冻结发原始 JSON：按 gzip magic 检测，存储侧统一为 gz
  if (!(data[0] === 0x1f && data[1] === 0x8b)) data = gzipSync(data);

  const user = currentUserOrNull();
  const member = user ? undefined : currentMemberOrNull();
  // 匿名上报凭 site key 归属租户（与错误上报同一规则）
  const site = (!user && !member) ? await resolveSiteByKey(reqCtx.siteKey).catch(() => null) : null;
  if (site && !isSiteOriginAllowed(reqCtx.origin, site.allowedOrigins)) return;
  const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
  const env = parseClientEnv(reqCtx.ua);
  const platform = resolveIngestPlatformFields(meta, { hasAdmin: !!user, hasMember: !!member });
  if (!user && !member && site) platform.appId = site.appId;

  const startedAt = new Date(meta.startedAt);
  const fromTs = new Date(meta.fromTs);
  const toTs = new Date(meta.toTs);
  const durationMs = Math.max(0, meta.toTs - meta.startedAt);

  // 配额治理：超配额触发异步滚动淘汰（不阻塞本次上报）；超硬顶拒收纯采样录制（错误现场永远收）
  const quotaBytes = await getReplayQuotaBytes(tenantId);
  if (quotaBytes > 0) {
    const usage = await getReplayUsageBytes(tenantId);
    if (usage >= quotaBytes * QUOTA_HARD_LIMIT && !meta.triggers.some((t) => t.type !== 'sampled')) {
      return; // 静默丢弃：SDK 无需感知，避免重试风暴
    }
    if (usage >= quotaBytes) void enforceReplayQuota(tenantId, quotaBytes).catch(() => { /* 下一分片再触发 */ });
  }

  await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(replaySessions)
      .values({
        id: meta.replayId,
        tenantId,
        sessionId: meta.sessionId,
        mode: meta.mode,
        status: meta.final ? 'completed' : 'recording',
        triggers: meta.triggers,
        startedAt,
        endedAt: meta.final ? toTs : null,
        durationMs,
        entryPageUrl: meta.entryPageUrl?.slice(0, 512) ?? null,
        source: platform.source,
        appId: platform.appId,
        environment: platform.environment,
        userId: user?.userId ?? null,
        username: user?.username ?? null,
        memberId: member?.memberId ?? null,
        browser: env.browser,
        os: env.os,
        deviceType: env.deviceType,
        sdkVersion: meta.sdkVersion ?? null,
      })
      .onConflictDoUpdate({
        target: replaySessions.id,
        set: {
          // triggers 全量覆盖：SDK 侧维护累积数组，后到分片携带最全集合
          triggers: meta.triggers,
          ...(meta.final ? { status: 'completed' as const, endedAt: toTs } : {}),
          durationMs: sql`GREATEST(${replaySessions.durationMs}, ${durationMs})`,
          lastActivityAt: new Date(),
        },
      })
      .returning({ id: replaySessions.id, segmentCount: replaySessions.segmentCount });
    if (!session) return;
    if (session.segmentCount >= REPLAY_MAX_SEGMENTS) throw new HTTPException(400, { message: '回放分片数已达上限' });

    const inserted = await tx
      .insert(replaySegments)
      .values({
        replayId: meta.replayId,
        seq: meta.seq,
        data,
        fromTs,
        toTs,
        byteSize: data.byteLength,
        eventCount: meta.eventCount,
        hasFullSnapshot: meta.hasFullSnapshot,
      })
      .onConflictDoNothing()
      .returning({ id: replaySegments.id });

    // 重复分片（重传）：跳过聚合累加
    if (inserted.length > 0) {
      await tx
        .update(replaySessions)
        .set({
          segmentCount: sql`${replaySessions.segmentCount} + 1`,
          totalBytes: sql`${replaySessions.totalBytes} + ${data.byteLength}`,
          pageCount: sql`${replaySessions.pageCount} + ${meta.pageCount}`,
          clickCount: sql`${replaySessions.clickCount} + ${meta.clickCount}`,
          // 检索索引去重合并（SQL 侧 DISTINCT，JS 侧上限截断）
          ...(meta.pagePaths.length > 0 ? {
            pagePaths: sql`(SELECT COALESCE(jsonb_agg(DISTINCT p), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(${replaySessions.pagePaths} || ${JSON.stringify(meta.pagePaths.slice(0, 20))}::jsonb) AS p LIMIT 40) t)`,
          } : {}),
          ...(meta.clickLabels.length > 0 ? {
            clickLabels: sql`(SELECT COALESCE(jsonb_agg(DISTINCT c), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(${replaySessions.clickLabels} || ${JSON.stringify(meta.clickLabels.slice(0, 30))}::jsonb) AS c LIMIT 60) t)`,
          } : {}),
        })
        .where(eq(replaySessions.id, meta.replayId));
      // 页面点击热力事实表（与会话解耦，best-effort）
      const heatPoints = meta.clickPoints.filter((p) => p.path).slice(0, 100);
      if (heatPoints.length > 0) {
        await tx.insert(replayClickPoints).values(
          heatPoints.map((p) => ({ tenantId, pagePath: p.path, xPct: p.x, yPct: p.y, source: platform.source })),
        ).onConflictDoNothing();
      }
      bumpUsageCache(tenantId, data.byteLength);
    }
  });
}

// ─── 存储配额治理（滚动淘汰 + 硬顶熔断）───────────────────────────────────────
/** 用量进程内缓存：30s TTL + ingest 增量累加，配额为软限制无需强一致 */
const usageCache = new Map<number, { at: number; bytes: number }>();
const evictingTenants = new Set<number>();

function usageCacheKey(tenantId: number | null): number {
  return tenantId ?? 0;
}

function bumpUsageCache(tenantId: number | null, delta: number): void {
  const entry = usageCache.get(usageCacheKey(tenantId));
  if (entry) entry.bytes += delta;
}

async function getReplayQuotaBytes(tenantId: number | null): Promise<number> {
  const [row] = await db
    .select({ quotaMb: analyticsSettings.replayStorageQuotaMb })
    .from(analyticsSettings)
    .where(exactTenantCondition(analyticsSettings.tenantId, tenantId))
    .limit(1);
  return (row?.quotaMb ?? 4096) * 1024 * 1024;
}

/** 当前租户回放总占用（字节），30s 缓存 */
export async function getReplayUsageBytes(tenantId: number | null): Promise<number> {
  const key = usageCacheKey(tenantId);
  const cached = usageCache.get(key);
  if (cached && Date.now() - cached.at < USAGE_CACHE_TTL_MS) return cached.bytes;
  const scope = exactTenantCondition(replaySessions.tenantId, tenantId);
  const [row] = await db
    .select({ bytes: sql<number>`COALESCE(SUM(${replaySessions.totalBytes}), 0)::bigint` })
    .from(replaySessions)
    .where(scope);
  const bytes = Number(row?.bytes ?? 0);
  usageCache.set(key, { at: Date.now(), bytes });
  return bytes;
}

/**
 * 滚动淘汰到低水位（配额 90%）：价值分级——先删无错误回放（最旧优先），
 * 再删有错误回放（最旧优先，保护还在排查中的现场尽量靠后）。
 * 进程内互斥防止并发重复淘汰；多实例下重复执行也幂等无害。
 */
export async function enforceReplayQuota(tenantId: number | null, quotaBytes: number): Promise<number> {
  const key = usageCacheKey(tenantId);
  if (evictingTenants.has(key)) return 0;
  evictingTenants.add(key);
  try {
    const target = quotaBytes * QUOTA_LOW_WATERMARK;
    const scope = exactTenantCondition(replaySessions.tenantId, tenantId);
    let deleted = 0;
    // 两梯队：无错误（价值低）→ 全部剩余；录制中的活跃会话不淘汰
    for (const tier of [eq(replaySessions.errorCount, 0), undefined]) {
      for (let i = 0; i < 50; i++) {
        if ((await getReplayUsageBytesFresh(tenantId)) <= target) return deleted;
        const victims = await db
          .select({ id: replaySessions.id })
          .from(replaySessions)
          .where(and(scope, tier, sql`${replaySessions.status} != 'recording'`))
          .orderBy(replaySessions.startedAt)
          .limit(20);
        if (victims.length === 0) break;
        const rows = await db
          .delete(replaySessions)
          .where(inArray(replaySessions.id, victims.map((v) => v.id)))
          .returning({ bytes: replaySessions.totalBytes });
        deleted += rows.length;
        usageCache.delete(key);
        if (rows.length === 0) break;
      }
    }
    return deleted;
  } finally {
    evictingTenants.delete(key);
  }
}

/** 绕过缓存的实时用量（淘汰循环内部使用） */
async function getReplayUsageBytesFresh(tenantId: number | null): Promise<number> {
  usageCache.delete(usageCacheKey(tenantId));
  return getReplayUsageBytes(tenantId);
}

/** 存储统计（容量看板）：总量 / 今日新增 / 配额使用率 */
export async function getReplayStorageStats() {
  const where = tenantScope(replaySessions);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [[totals], [today], quotaBytes] = await Promise.all([
    db.select({
      bytes: sql<number>`COALESCE(SUM(${replaySessions.totalBytes}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    }).from(replaySessions).where(where),
    db.select({
      bytes: sql<number>`COALESCE(SUM(${replaySessions.totalBytes}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    }).from(replaySessions).where(buildWhere(where, gte(replaySessions.createdAt, todayStart))),
    getReplayQuotaBytes(currentUserOrNull() ? getCreateTenantId(currentUserOrNull()!) : null),
  ]);
  const totalBytes = Number(totals?.bytes ?? 0);
  const quotaMb = Math.round(quotaBytes / 1024 / 1024);
  return {
    totalBytes,
    totalCount: totals?.count ?? 0,
    todayBytes: Number(today?.bytes ?? 0),
    todayCount: today?.count ?? 0,
    quotaMb,
    usagePercent: quotaMb > 0 ? Math.round((totalBytes / quotaBytes) * 100) : 0,
  };
}

/** 监控告警指标：回放存储占用（MB，平台级口径） */
export async function getReplayStorageMbMetric(): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<number>`COALESCE(SUM(${replaySessions.totalBytes}), 0)::bigint` })
    .from(replaySessions);
  return Math.round(Number(row?.bytes ?? 0) / 1024 / 1024);
}

// ─── 页面点击热力（五期）──────────────────────────────────────────────────────
/** 有点击数据的页面路径清单（热力页下拉） */
export async function listHeatmapPages(days: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .selectDistinct({ pagePath: replayClickPoints.pagePath })
    .from(replayClickPoints)
    .where(buildWhere(tenantScope(replayClickPoints), gte(replayClickPoints.createdAt, cutoff)))
    .orderBy(replayClickPoints.pagePath)
    .limit(200);
  return rows.map((r) => r.pagePath);
}

/** 页面点击热力聚合：坐标按 2% 网格聚合计数 */
export async function getClickHeatmap(pagePath: string, days: number) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const where = buildWhere(
    tenantScope(replayClickPoints),
    and(eq(replayClickPoints.pagePath, pagePath), gte(replayClickPoints.createdAt, cutoff)),
  );
  const rows = await db
    .select({
      x: sql<number>`(${replayClickPoints.xPct} / 2 * 2)::int`,
      y: sql<number>`(${replayClickPoints.yPct} / 2 * 2)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(replayClickPoints)
    .where(where)
    .groupBy(sql`1, 2`)
    .orderBy(sql`3 DESC`)
    .limit(2000);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return { points: rows, total };
}

// ─── 访问审计（合规留痕）──────────────────────────────────────────────────────
/**
 * 记录回放查看行为（best-effort 异步，不阻塞查看）。
 * 同一用户对同一回放 10 分钟内去重——实时旁观的 3s 轮询不会刷屏审计。
 */
export function recordReplayAccess(replay: { id: string; tenantId: number | null; username: string | null; memberId: number | null }, ip: string | null): void {
  const user = currentUserOrNull();
  if (!user) return;
  void (async () => {
    const cutoff = new Date(Date.now() - 10 * 60_000);
    const [recent] = await db
      .select({ id: replayAccessLogs.id })
      .from(replayAccessLogs)
      .where(and(
        eq(replayAccessLogs.replayId, replay.id),
        eq(replayAccessLogs.userId, user.userId),
        gte(replayAccessLogs.createdAt, cutoff),
      ))
      .limit(1);
    if (recent) return;
    await db.insert(replayAccessLogs).values({
      tenantId: replay.tenantId,
      replayId: replay.id,
      replayOwner: replay.username ?? (replay.memberId ? `会员#${replay.memberId}` : '匿名'),
      userId: user.userId,
      username: user.username ?? null,
      action: 'view',
      ip,
    });
  })().catch(() => { /* 审计留痕失败不影响查看 */ });
}

export async function listReplayAccessLogs(query: { page: number; pageSize: number; replayId?: string; keyword?: string }) {
  const conditions = [
    query.replayId ? eq(replayAccessLogs.replayId, query.replayId) : undefined,
    query.keyword
      ? or(keywordCondition(query.keyword, [replayAccessLogs.username, replayAccessLogs.replayOwner], 'ilike'), eq(replayAccessLogs.replayId, query.keyword))
      : undefined,
  ];
  const where = buildWhere(tenantScope(replayAccessLogs), and(...conditions.filter(Boolean)));
  return buildListResult({
    page: query.page,
    pageSize: query.pageSize,
    count: () => db.select({ total: sql<number>`count(*)::int` }).from(replayAccessLogs).where(where).then((r) => r[0]?.total ?? 0),
    rows: () => db.select().from(replayAccessLogs).where(where)
      .orderBy(desc(replayAccessLogs.createdAt))
      .limit(query.pageSize).offset(pageOffset(query.page, query.pageSize)),
    map: (r) => ({
      id: r.id,
      replayId: r.replayId,
      replayOwner: r.replayOwner,
      userId: r.userId,
      username: r.username,
      action: r.action,
      ip: r.ip,
      createdAt: formatDateTime(r.createdAt),
    }),
  });
}

/** 错误上报到达时回填回放会话的错误计数（错误服务调用） */
export async function bumpReplayErrorCount(replayId: string): Promise<void> {
  await db
    .update(replaySessions)
    .set({ errorCount: sql`${replaySessions.errorCount} + 1` })
    .where(eq(replaySessions.id, replayId));
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
export interface ReplayListQuery {
  page: number;
  pageSize: number;
  status?: string;
  mode?: string;
  triggerType?: string;
  keyword?: string;
  hasError?: boolean;
  source?: string;
  /** 内容检索：访问过的页面路径（模糊） */
  pagePath?: string;
  /** 内容检索：点击过的元素文案（模糊） */
  clickLabel?: string;
}

export async function listReplaySessions(query: ReplayListQuery) {
  const conditions = [
    query.status ? eq(replaySessions.status, query.status as ReplaySessionRow['status']) : undefined,
    query.mode ? eq(replaySessions.mode, query.mode as ReplaySessionRow['mode']) : undefined,
    query.source ? eq(replaySessions.source, query.source as ReplaySessionRow['source']) : undefined,
    query.hasError ? gte(replaySessions.errorCount, 1) : undefined,
    // triggers jsonb 数组按类型匹配（@> 走 GIN 语义，量级可控走 seq scan 亦可）
    query.triggerType ? sql`${replaySessions.triggers} @> ${JSON.stringify([{ type: query.triggerType }])}::jsonb` : undefined,
    // 内容检索：jsonb 数组元素模糊匹配（回放行数有限，EXISTS 子查询足够快）
    query.pagePath
      ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${replaySessions.pagePaths}) p WHERE ${keywordCondition(query.pagePath, [sql`p`], 'ilike') ?? sql`false`})`
      : undefined,
    query.clickLabel
      ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${replaySessions.clickLabels}) c WHERE ${keywordCondition(query.clickLabel, [sql`c`], 'ilike') ?? sql`false`})`
      : undefined,
    query.keyword
      ? or(
          keywordCondition(query.keyword, [replaySessions.username, replaySessions.entryPageUrl], 'ilike'),
          eq(replaySessions.id, query.keyword),
          eq(replaySessions.sessionId, query.keyword),
        )
      : undefined,
  ];
  const where = buildWhere(tenantScope(replaySessions), and(...conditions.filter(Boolean)));

  return buildListResult({
    page: query.page,
    pageSize: query.pageSize,
    count: () => db.select({ total: sql<number>`count(*)::int` }).from(replaySessions).where(where).then((r) => r[0]?.total ?? 0),
    rows: () => db.select().from(replaySessions).where(where)
      .orderBy(desc(replaySessions.startedAt))
      .limit(query.pageSize).offset(pageOffset(query.page, query.pageSize)),
    map: mapReplaySession,
  });
}

export async function getReplaySessionDetail(id: string, accessIp?: string | null) {
  const where = buildWhere(tenantScope(replaySessions), eq(replaySessions.id, id));
  const [row] = await db.select().from(replaySessions).where(where).limit(1);
  requireRow(row, '回放会话不存在');
  // 合规留痕：谁查看了这条录像（best-effort，10 分钟去重覆盖 live 轮询）
  recordReplayAccess({ id: row.id, tenantId: row.tenantId, username: row.username, memberId: row.memberId }, accessIp ?? null);

  const endBound = row.endedAt ?? row.lastActivityAt;
  const [segments, errors, perfRows, siblingRows] = await Promise.all([
    db.select({
      id: replaySegments.id,
      replayId: replaySegments.replayId,
      seq: replaySegments.seq,
      fromTs: replaySegments.fromTs,
      toTs: replaySegments.toTs,
      byteSize: replaySegments.byteSize,
      eventCount: replaySegments.eventCount,
      hasFullSnapshot: replaySegments.hasFullSnapshot,
      createdAt: replaySegments.createdAt,
    }).from(replaySegments)
      .where(eq(replaySegments.replayId, id))
      .orderBy(replaySegments.seq),
    db.select({
      id: errorEvents.id,
      groupId: errorEvents.groupId,
      errorType: errorEvents.errorType,
      level: errorEvents.level,
      message: errorEvents.message,
      createdAt: errorEvents.createdAt,
    }).from(errorEvents)
      .where(eq(errorEvents.replayId, id))
      .orderBy(errorEvents.createdAt)
      .limit(100),
    // 回放期间的 Web Vitals（同 tracker 会话 + 时间窗，时间轴性能标记）
    db.select({
      metricName: userEvents.metricName,
      metricValue: userEvents.metricValue,
      createdAt: userEvents.createdAt,
    }).from(userEvents)
      .where(and(
        eq(userEvents.sessionId, row.sessionId),
        eq(userEvents.eventType, 'perf'),
        gte(userEvents.createdAt, row.startedAt),
        lt(userEvents.createdAt, new Date(endBound.getTime() + 60_000)),
      ))
      .orderBy(userEvents.createdAt)
      .limit(50),
    // 同一浏览器会话的其它回放片段（旅程拼接）
    db.select({
      id: replaySessions.id,
      status: replaySessions.status,
      startedAt: replaySessions.startedAt,
      durationMs: replaySessions.durationMs,
      errorCount: replaySessions.errorCount,
      entryPageUrl: replaySessions.entryPageUrl,
    }).from(replaySessions)
      .where(buildWhere(tenantScope(replaySessions), and(eq(replaySessions.sessionId, row.sessionId), sql`${replaySessions.id} != ${id}`)))
      .orderBy(replaySessions.startedAt)
      .limit(20),
  ]);

  return {
    ...mapReplaySession(row),
    segments: segments.map(mapSegmentMeta),
    errors: errors.map((e) => ({ ...e, createdAt: formatDateTime(e.createdAt) })),
    perfEvents: perfRows
      .filter((p) => p.metricName != null && p.metricValue != null)
      .map((p) => ({ metricName: p.metricName!, metricValue: p.metricValue!, createdAt: formatDateTime(p.createdAt) })),
    siblings: siblingRows.map((s) => ({
      id: s.id,
      status: s.status,
      startedAt: formatDateTime(s.startedAt),
      durationMs: s.durationMs,
      errorCount: s.errorCount,
      entryPageUrl: s.entryPageUrl,
    })),
  };
}

/** 拉取分片二进制（gzip JSON，路由以 Content-Encoding: gzip 透传，浏览器自动解压） */
export async function getReplaySegmentData(replayId: string, seq: number): Promise<Buffer> {
  const where = buildWhere(tenantScope(replaySessions), eq(replaySessions.id, replayId));
  const [session] = await db.select({ id: replaySessions.id }).from(replaySessions).where(where).limit(1);
  requireRow(session, '回放会话不存在');
  const [segment] = await db
    .select({ data: replaySegments.data })
    .from(replaySegments)
    .where(and(eq(replaySegments.replayId, replayId), eq(replaySegments.seq, seq)))
    .limit(1);
  requireRow(segment, '回放分片不存在');
  return segment.data;
}

export async function deleteReplaySessions(ids: string[]): Promise<number> {
  const where = buildWhere(tenantScope(replaySessions), inArray(replaySessions.id, ids));
  const deleted = await db.delete(replaySessions).where(where).returning({ id: replaySessions.id });
  return deleted.length;
}

// ─── 运维 ─────────────────────────────────────────────────────────────────────
/** 收尾僵尸会话：recording 且超过阈值无新分片 → expired（endedAt 取最后分片时间） */
export async function finalizeStaleReplays(): Promise<number> {
  const cutoff = new Date(Date.now() - REPLAY_STALE_MINUTES * 60_000);
  const stale = await db
    .update(replaySessions)
    .set({
      status: 'expired',
      endedAt: sql`COALESCE((SELECT MAX(${replaySegments.toTs}) FROM ${replaySegments} WHERE ${replaySegments.replayId} = ${replaySessions.id}), ${replaySessions.lastActivityAt})`,
    })
    .where(and(eq(replaySessions.status, 'recording'), lt(replaySessions.lastActivityAt, cutoff)))
    .returning({ id: replaySessions.id });
  return stale.length;
}
