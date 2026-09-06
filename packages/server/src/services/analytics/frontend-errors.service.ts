import { and, eq, gte, desc, inArray, sql, countDistinct } from 'drizzle-orm';
import { db } from '../../db';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { errorGroups, errorEvents, errorGroupIdentities, sourceMaps, users } from '../../db/schema';
import type { ErrorGroupRow, ErrorEventRow } from '../../db/schema';
import type { FrontendErrorType, ErrorLevel, ErrorBreadcrumb, UpdateErrorGroupInput, SourceMapUploadInput, AnalyticsEventSource, AnalyticsEnvironment } from '@zenith/shared/analytics';
import { currentUserOrNull } from '../../lib/context';
import { currentMemberOrNull } from '../../lib/member-context';
import { tenantScope, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, formatDate, APP_TIME_ZONE, parseDateRangeStart } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { parseClientEnv, computeErrorFingerprint, startOfDaysAgo, clampDays, clampLimit, resolveIngestPlatformFields } from '../../lib/analytics-helpers';
import { clearSymbolicateCache, symbolicateStack } from '../../lib/source-map-symbolicate';
import { evaluateAlertsForError } from './error-alert.service';
import { isSiteOriginAllowed, resolveSiteByKey } from './analytics-sites.service';
import { recordQualityIssue } from './analytics-governance.service';
import { isErrorIgnored } from './analytics-settings.service';
import { bumpReplayErrorCount } from './session-replays.service';
import { notify } from '../messaging/notification-outbox.service';
import logger from '../../lib/logger';

export interface ErrorReqCtx { ip: string; ua: string; siteKey?: string | null; origin?: string | null }

function defaultLevel(type: FrontendErrorType): ErrorLevel {
  if (type === 'resource_error' || type === 'console_error') return 'warning';
  if (type === 'crash' || type === 'white_screen') return 'fatal';
  return 'error';
}

export function mapGroup(row: ErrorGroupRow) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    errorType: row.errorType,
    level: row.level,
    message: row.message,
    status: row.status,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    release: row.release,
    note: row.note,
    environment: row.environment,
    count: Number(row.count),
    affectedUsers: row.affectedUsers,
    firstSeenAt: formatDateTime(row.firstSeenAt),
    lastSeenAt: formatDateTime(row.lastSeenAt),
    resolvedAt: formatNullableDateTime(row.resolvedAt),
  };
}

export function mapEvent(row: ErrorEventRow) {
  return {
    id: row.id,
    groupId: row.groupId,
    fingerprint: row.fingerprint,
    errorType: row.errorType,
    level: row.level,
    message: row.message,
    stack: row.stack,
    sourceUrl: row.sourceUrl,
    lineNo: row.lineNo,
    colNo: row.colNo,
    pageUrl: row.pageUrl,
    release: row.release,
    userAgent: row.userAgent,
    browser: row.browser,
    browserVersion: row.browserVersion,
    os: row.os,
    deviceType: row.deviceType,
    userId: row.userId,
    username: row.username,
    sessionId: row.sessionId,
    breadcrumbs: (row.breadcrumbs as ErrorBreadcrumb[] | null) ?? null,
    context: row.context ?? null,
    httpStatus: row.httpStatus,
    httpMethod: row.httpMethod,
    httpUrl: row.httpUrl,
    source: row.source,
    appId: row.appId,
    environment: row.environment,
    memberId: row.memberId,
    replayId: row.replayId,
    createdAt: formatDateTime(row.createdAt),
  };
}

const DAY_MS = 86_400_000;
const affectedIdentity = sql<string>`
  CASE
    WHEN ${errorEvents.userId} IS NOT NULL THEN 'u:' || ${errorEvents.userId}::text
    WHEN ${errorEvents.memberId} IS NOT NULL THEN 'm:' || ${errorEvents.memberId}::text
    WHEN ${errorEvents.sessionId} IS NOT NULL THEN 'a:' || ${errorEvents.sessionId}
    ELSE NULL
  END
`;

function dateAxis(days: number): string[] {
  const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
  const firstDay = todayStart.getTime() - (days - 1) * DAY_MS;
  return Array.from({ length: days }, (_, index) => formatDate(new Date(firstDay + index * DAY_MS)));
}

// ─── 上报 ─────────────────────────────────────────────────────────────────────
export async function reportError(input: {
  errorType: FrontendErrorType;
  level?: ErrorLevel;
  message: string;
  stack?: string;
  sourceUrl?: string;
  lineNo?: number;
  colNo?: number;
  pageUrl?: string;
  release?: string;
  sessionId?: string;
  breadcrumbs?: unknown[];
  context?: Record<string, unknown>;
  httpStatus?: number;
  httpMethod?: string;
  httpUrl?: string;
  source?: AnalyticsEventSource;
  appId?: string;
  environment?: AnalyticsEnvironment;
  replayId?: string;
}, reqCtx: ErrorReqCtx): Promise<void> {
  const user = currentUserOrNull();
  // 管理员 / 会员身份互斥：单次请求只会经过其中一种认证中间件
  const member = user ? undefined : currentMemberOrNull();
  // 匿名错误上报凭 site key 归属租户（与事件采集 batchInsertEvents 同一规则；登录态忽略 siteKey）
  const site = (!user && !member) ? await resolveSiteByKey(reqCtx.siteKey).catch(() => null) : null;
  if (site && !isSiteOriginAllowed(reqCtx.origin, site.allowedOrigins)) {
    await recordQualityIssue(site.tenantId ?? 0, '$frontend_error', 'origin_rejected').catch((err) => {
      logger.warn('[frontend-errors] record origin rejection quality issue failed', err);
    });
    return;
  }
  const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
  const env = parseClientEnv(reqCtx.ua);
  const level = input.level ?? defaultLevel(input.errorType);
  const message = input.message.slice(0, 2000);
  const platform = resolveIngestPlatformFields(input, { hasAdmin: !!user, hasMember: !!member });
  if (!user && !member && site) platform.appId = site.appId;

  // 忽略规则：命中租户配置的正则即丢弃（压制 dev-only 框架告警 / 插件噪音等已知无价值错误）
  if (await isErrorIgnored(tenantId, message)) return;

  const fingerprint = computeErrorFingerprint({ tenantId, errorType: input.errorType, message: input.message, sourceUrl: input.sourceUrl, stack: input.stack, environment: platform.environment });
  const now = new Date();
  const displayName = user?.username ?? member?.identifier ?? null;

  const group = await db.transaction(async (tx) => {
    const [upserted] = await tx
      .insert(errorGroups)
      .values({ tenantId, fingerprint, errorType: input.errorType, level, message, release: input.release ?? null, environment: platform.environment, count: 1, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: errorGroups.fingerprint,
        set: {
          count: sql`${errorGroups.count} + 1`,
          lastSeenAt: now,
          message,
          release: input.release ?? sql`${errorGroups.release}`,
          status: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN 'unresolved'::error_status ELSE ${errorGroups.status} END`,
          resolvedAt: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN NULL ELSE ${errorGroups.resolvedAt} END`,
        },
      })
      .returning();

    await tx.insert(errorEvents).values({
      tenantId,
      groupId: upserted.id,
      fingerprint,
      errorType: input.errorType,
      level,
      message,
      stack: input.stack ?? null,
      sourceUrl: input.sourceUrl ?? null,
      lineNo: input.lineNo ?? null,
      colNo: input.colNo ?? null,
      pageUrl: input.pageUrl ?? null,
      release: input.release ?? null,
      userAgent: reqCtx.ua.slice(0, 512),
      browser: env.browser,
      browserVersion: env.browserVersion,
      os: env.os,
      deviceType: env.deviceType,
      userId: user?.userId ?? null,
      username: displayName,
      sessionId: input.sessionId ?? null,
      breadcrumbs: input.breadcrumbs ?? null,
      context: input.context ?? null,
      httpStatus: input.httpStatus ?? null,
      httpMethod: input.httpMethod ?? null,
      httpUrl: input.httpUrl ?? null,
      source: platform.source,
      appId: platform.appId,
      environment: platform.environment,
      memberId: member?.memberId ?? null,
      replayId: input.replayId ?? null,
    });

    // 影响用户数 O(1) 增量维护：身份首次出现在该分组时 +1（替代旧的详情页 COUNT(DISTINCT) 懒回写）
    const identity = user?.userId != null
      ? `u:${user.userId}`
      : member?.memberId != null
        ? `m:${member.memberId}`
        : input.sessionId
          ? `a:${input.sessionId}`
          : null;
    if (identity) {
      const inserted = await tx
        .insert(errorGroupIdentities)
        .values({ groupId: upserted.id, identity: identity.slice(0, 80) })
        .onConflictDoNothing()
        .returning({ groupId: errorGroupIdentities.groupId });
      if (inserted.length > 0) {
        await tx
          .update(errorGroups)
          .set({ affectedUsers: sql`${errorGroups.affectedUsers} + 1` })
          .where(eq(errorGroups.id, upserted.id));
      }
    }
    return upserted;
  });

  // 实时告警联动（best-effort，不阻塞上报响应）；count===1 表示本次新建分组
  void evaluateAlertsForError({ tenantId, errorType: input.errorType, level, isNewGroup: group.count === 1 })
    .catch(() => { /* cron 保底，评估失败不影响上报 */ });

  // 回放会话错误计数回填（best-effort：回放会话可能尚未创建，首分片稍后才到）
  if (input.replayId) {
    void bumpReplayErrorCount(input.replayId).catch(() => { /* 回放未落地时静默 */ });
  }
}

// ─── 分组列表 ─────────────────────────────────────────────────────────────────
export interface GroupListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  errorType?: string;
  level?: string;
  keyword?: string;
  assigneeId?: number;
  environment?: string;
}
export async function listGroups(q: GroupListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  if (q.status) conditions.push(eq(errorGroups.status, q.status as 'unresolved'));
  if (q.errorType) conditions.push(eq(errorGroups.errorType, q.errorType as 'js_error'));
  if (q.level) conditions.push(eq(errorGroups.level, q.level as 'error'));
  if (q.assigneeId) conditions.push(eq(errorGroups.assigneeId, q.assigneeId));
  conditions.push(keywordCondition(q.keyword, [errorGroups.message]));
  if (q.environment) conditions.push(eq(errorGroups.environment, q.environment as 'production'));
  const where = buildWhere(...conditions, tenantScope(errorGroups));

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(errorGroups, where),
    rows: async () => {
      const list = await db.select().from(errorGroups).where(where).orderBy(desc(errorGroups.lastSeenAt)).limit(pageSize).offset(pageOffset(page, pageSize));
      // 页内分组的近 7 日发生趋势（迷你曲线），一次查询批量取回
      const trendByGroup = new Map<number, Map<string, number>>();
      if (list.length > 0) {
        const trendStart = startOfDaysAgo(7);
        const rows = await db
          .select({
            groupId: errorEvents.groupId,
            date: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${errorEvents.createdAt}), 'YYYY-MM-DD')`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(errorEvents)
          .where(and(inArray(errorEvents.groupId, list.map((g) => g.id)), gte(errorEvents.createdAt, trendStart)))
          .groupBy(errorEvents.groupId, sql`2`);
        for (const r of rows) {
          if (!trendByGroup.has(r.groupId)) trendByGroup.set(r.groupId, new Map());
          trendByGroup.get(r.groupId)!.set(r.date, Number(r.count));
        }
      }
      const axis = dateAxis(7);
      return list.map((g) => ({
        ...mapGroup(g),
        trend: axis.map((d) => trendByGroup.get(g.id)?.get(d) ?? 0),
      }));
    },
  });
}

export async function ensureGroupExists(id: number) {
  const [row] = await db.select().from(errorGroups).where(buildWhere(eq(errorGroups.id, id), tenantScope(errorGroups))).limit(1);
  return requireRow(row, '错误分组不存在');
}

// ─── 分组详情（趋势 / 分布 / 最近事件 / 堆栈还原）────────────────────────────
export async function getGroupDetail(id: number) {
  const group = await ensureGroupExists(id);
  const start = startOfDaysAgo(14);

  const [trendRows, browserRows, osRows, recent] = await Promise.all([
    db
      .select({ date: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${errorEvents.createdAt}), 'YYYY-MM-DD')`, count: sql<number>`COUNT(*)::int` })
      .from(errorEvents)
      .where(and(eq(errorEvents.groupId, id), gte(errorEvents.createdAt, start)))
      .groupBy(sql`1`),
    db.select({ name: errorEvents.browser, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(errorEvents.browser).orderBy(sql`COUNT(*) DESC`).limit(6),
    db.select({ name: errorEvents.os, value: sql<number>`COUNT(*)::int` }).from(errorEvents).where(eq(errorEvents.groupId, id)).groupBy(errorEvents.os).orderBy(sql`COUNT(*) DESC`).limit(6),
    db.select().from(errorEvents).where(eq(errorEvents.groupId, id)).orderBy(desc(errorEvents.createdAt)).limit(20),
  ]);

  // 堆栈还原：取最近事件 stack + 该 release 的 source maps
  let symbolicatedStack: string | null = null;
  const latest = recent[0];
  if (latest?.stack && latest.release) {
    const maps = await db
      .select({ id: sourceMaps.id, updatedAt: sourceMaps.updatedAt, fileName: sourceMaps.fileName, content: sourceMaps.content })
      .from(sourceMaps)
      .where(buildWhere(eq(sourceMaps.release, latest.release), tenantScope(sourceMaps)));
    if (maps.length > 0) {
      symbolicatedStack = await symbolicateStack(
        latest.stack,
        // 缓存键含 id+updatedAt：replace（先删后插）产生新 id，旧缓存自然失效
        maps.map((m) => ({ fileName: m.fileName, content: m.content, cacheKey: `${m.id}:${m.updatedAt.getTime()}` })),
      );
    }
  }

  // 趋势补轴
  const axis = dateAxis(14);
  const trendMap = new Map(trendRows.map((r) => [r.date, Number(r.count)]));

  return {
    group: mapGroup(group),
    symbolicatedStack,
    trend: axis.map((date) => ({ date, count: trendMap.get(date) ?? 0 })),
    browsers: browserRows.map((r) => ({ name: r.name ?? '未知', value: Number(r.value) })),
    os: osRows.map((r) => ({ name: r.name ?? '未知', value: Number(r.value) })),
    recentEvents: recent.map(mapEvent),
  };
}

// ─── 处理（更新 Issue）────────────────────────────────────────────────────────
export async function updateGroup(id: number, input: UpdateErrorGroupInput) {
  const prev = await ensureGroupExists(id);
  let assigneeName: string | null | undefined;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) assigneeName = null;
    else {
      const [u] = await db
        .select({ nickname: users.nickname, username: users.username })
        .from(users)
        .where(buildWhere(eq(users.id, input.assigneeId), tenantScope(users)))
        .limit(1);
      requireRow(u, '指派用户不存在或不属于当前租户', 400);
      assigneeName = u.nickname || u.username;
    }
  }
  const setResolved = input.status === 'resolved';
  const [row] = await db
    .update(errorGroups)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId, assigneeName: assigneeName ?? null } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.status !== undefined ? { resolvedAt: setResolved ? new Date() : null } : {}),
    })
    .where(eq(errorGroups.id, id))
    .returning();

  // 指派变更时通知被指派人（重复指派同一人、自派自不通知）；失败不阻断主流程
  const operator = currentUserOrNull();
  if (input.assigneeId != null && input.assigneeId !== prev.assigneeId && input.assigneeId !== operator?.userId) {
    try {
      const [op] = operator
        ? await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, operator.userId)).limit(1)
        : [];
      await notify('analytics.error.assigned', {
        recipients: [{ type: 'user', id: input.assigneeId }],
        vars: {
          groupId: id,
          message: row.message.length > 80 ? `${row.message.slice(0, 80)}…` : row.message,
          assignerName: op?.nickname || operator?.username || '系统',
        },
        link: `/analytics/errors?issue=${id}`,
        tenantId: row.tenantId ?? null,
      });
    } catch (err) {
      logger.warn('[frontend-errors] 指派通知发送失败', { id, err });
    }
  }
  return mapGroup(row);
}

export async function batchUpdateGroupStatus(ids: number[], status: 'unresolved' | 'resolved' | 'ignored' | 'muted') {
  if (ids.length === 0) return 0;
  const where = buildWhere(inArray(errorGroups.id, ids), tenantScope(errorGroups));
  const res = await db.update(errorGroups).set({ status, resolvedAt: status === 'resolved' ? new Date() : null }).where(where);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export async function deleteGroups(ids: number[]) {
  if (ids.length === 0) return 0;
  const where = buildWhere(inArray(errorGroups.id, ids), tenantScope(errorGroups));
  const res = await db.delete(errorGroups).where(where);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ─── 概览 ─────────────────────────────────────────────────────────────────────
export async function getErrorOverview(daysRaw: unknown) {
  const days = clampDays(daysRaw, 30);
  const start = startOfDaysAgo(days);
  const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
  const gScope = tenantScope(errorGroups);
  const eScope = tenantScope(errorEvents);
  const recentGroups = buildWhere(gte(errorGroups.lastSeenAt, start), gScope);

  const [totals, byType, byLevel, trendRows, affected, topIssues, newToday] = await Promise.all([
    db
      .select({
        totalGroups: sql<number>`COUNT(*)::int`,
        unresolved: sql<number>`COUNT(*) FILTER (WHERE ${errorGroups.status} = 'unresolved')::int`,
        totalOccurrences: sql<number>`COALESCE(SUM(${errorGroups.count}), 0)::bigint`,
      })
      .from(errorGroups)
      .where(recentGroups),
    db.select({ errorType: errorGroups.errorType, groups: sql<number>`COUNT(*)::int`, occurrences: sql<number>`COALESCE(SUM(${errorGroups.count}),0)::bigint` }).from(errorGroups).where(recentGroups).groupBy(errorGroups.errorType),
    db.select({ level: errorGroups.level, groups: sql<number>`COUNT(*)::int`, occurrences: sql<number>`COALESCE(SUM(${errorGroups.count}),0)::bigint` }).from(errorGroups).where(recentGroups).groupBy(errorGroups.level),
    db
      .select({ date: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${errorEvents.createdAt}), 'YYYY-MM-DD')`, occurrences: sql<number>`COUNT(*)::int`, groups: countDistinct(errorEvents.groupId) })
      .from(errorEvents)
      .where(buildWhere(gte(errorEvents.createdAt, start), eScope))
      .groupBy(sql`1`),
    db.select({ n: sql<number>`COUNT(DISTINCT ${affectedIdentity})::int` }).from(errorEvents).where(buildWhere(gte(errorEvents.createdAt, start), eScope)),
    db.select().from(errorGroups).where(buildWhere(and(eq(errorGroups.status, 'unresolved'), gte(errorGroups.lastSeenAt, start)), gScope)).orderBy(desc(errorGroups.count)).limit(10),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(errorGroups).where(buildWhere(gte(errorGroups.firstSeenAt, todayStart), gScope)),
  ]);

  const axis = dateAxis(days);
  const trendMap = new Map(trendRows.map((r) => [r.date, r]));

  return {
    totalGroups: Number(totals[0]?.totalGroups ?? 0),
    unresolved: Number(totals[0]?.unresolved ?? 0),
    totalOccurrences: Number(totals[0]?.totalOccurrences ?? 0),
    affectedUsers: Number(affected[0]?.n ?? 0),
    newToday: Number(newToday[0]?.n ?? 0),
    byType: byType.map((r) => ({ errorType: r.errorType, groups: Number(r.groups), occurrences: Number(r.occurrences) })),
    byLevel: byLevel.map((r) => ({ level: r.level, groups: Number(r.groups), occurrences: Number(r.occurrences) })),
    trend: axis.map((date) => ({ date, occurrences: Number(trendMap.get(date)?.occurrences ?? 0), groups: Number(trendMap.get(date)?.groups ?? 0) })),
    topIssues: topIssues.map(mapGroup),
  };
}

// ─── 事件列表 ─────────────────────────────────────────────────────────────────
export interface ErrorEventListQuery { page?: number; pageSize?: number; groupId?: number }
export async function listErrorEvents(q: ErrorEventListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  if (q.groupId) conditions.push(eq(errorEvents.groupId, q.groupId));
  const where = buildWhere(...conditions, tenantScope(errorEvents));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(errorEvents, where),
    rows: () => db.select().from(errorEvents).where(where).orderBy(desc(errorEvents.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapEvent,
  });
}

export async function cleanErrors(days: number): Promise<number> {
  if (days > 0) {
    const res = await db.delete(errorEvents).where(buildWhere(sql`${errorEvents.createdAt} < NOW() - (${days} * INTERVAL '1 day')`, tenantScope(errorEvents)));
    await db.delete(errorGroups).where(buildWhere(sql`${errorGroups.lastSeenAt} < NOW() - (${days} * INTERVAL '1 day') AND NOT EXISTS (SELECT 1 FROM error_events ee WHERE ee.group_id = ${errorGroups.id})`, tenantScope(errorGroups)));
    return (res as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  const res = await db.delete(errorGroups).where(tenantScope(errorGroups));
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ─── Source Map ──────────────────────────────────────────────────────────────
export async function uploadSourceMap(input: SourceMapUploadInput) {
  const tenantId = (() => {
    const u = currentUserOrNull();
    return u ? getCreateTenantId(u) : null;
  })();
  // replace 语义：先删后插
  await db.delete(sourceMaps).where(buildWhere(and(eq(sourceMaps.release, input.release), eq(sourceMaps.fileName, input.fileName)), tenantScope(sourceMaps)));
  const [row] = await db.insert(sourceMaps).values({ tenantId, release: input.release, fileName: input.fileName, content: input.content, size: input.content.length }).returning();
  clearSymbolicateCache();
  return { id: row.id, release: row.release, fileName: row.fileName, size: row.size, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt) };
}

export interface SourceMapListQuery { page?: number; pageSize?: number; release?: string }
export async function listSourceMaps(q: SourceMapListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  conditions.push(keywordCondition(q.release, [sourceMaps.release]));
  const where = buildWhere(...conditions, tenantScope(sourceMaps));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(sourceMaps, where),
    rows: () => db.select({ id: sourceMaps.id, release: sourceMaps.release, fileName: sourceMaps.fileName, size: sourceMaps.size, createdAt: sourceMaps.createdAt, updatedAt: sourceMaps.updatedAt }).from(sourceMaps).where(where).orderBy(desc(sourceMaps.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: (r) => ({ id: r.id, release: r.release, fileName: r.fileName, size: r.size, createdAt: formatDateTime(r.createdAt), updatedAt: formatDateTime(r.updatedAt) }),
  });
}

export async function deleteSourceMap(id: number) {
  const where = buildWhere(eq(sourceMaps.id, id), tenantScope(sourceMaps));
  const [row] = await db.select({ id: sourceMaps.id }).from(sourceMaps).where(where).limit(1);
  requireRow(row, 'Source Map 不存在');
  await db.delete(sourceMaps).where(where);
  clearSymbolicateCache();
}
