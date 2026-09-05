import { and, eq, gte, lt, lte, isNotNull, sql, countDistinct, desc, notExists, inArray, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { db } from '../../db';
import { userEvents, analyticsSessions, analyticsDailyRollup } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { TrackEventInput, AnalyticsEventSource, AnalyticsEnvironment, AnalyticsIdentityType, AnalyticsDeviceType, UserBehaviorEventType } from '@zenith/shared/analytics';
import { ANALYTICS_RAGE_CLICK_EVENT, ANALYTICS_PATH_EXIT_PAGE } from '@zenith/shared/analytics';
import { currentUserOrNull } from '../../lib/context';
import { currentMemberOrNull } from '../../lib/member-context';
import { tenantScope, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatNullableDateTime, formatDateTime, formatDate, APP_TIME_ZONE, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { parseClientEnv, lookupIpGeo, clampDays, clampLimit, startOfDaysAgo, anonymizeIpAddr, resolveIngestPlatformFields } from '../../lib/analytics-helpers';
import { touchEventMeta } from './analytics-event-meta.service';
import { upsertUserProfilesBatch, type ProfileUpsertInput } from './analytics-profile.service';
import { processIdentityBindings, resolveAnonymousMappings, type IdentityBinding } from './analytics-identity.service';
import { evaluateEvents, recordQualityIssue, recordSchemaIssues, type PendingSchemaIssue } from './analytics-governance.service';
import { getIngestPolicy } from './analytics-settings.service';
import { isSiteOriginAllowed, resolveSiteByKey, type ResolvedAnalyticsSite } from './analytics-sites.service';
import { checkAndConsumeSiteQuota, refundSiteQuota } from './analytics-quota.service';
import { rollupTenantScope } from './analytics-rollup.service';
import { broadcast } from '../../lib/ws-manager';
import logger from '../../lib/logger';

// ════════════════════════════════════════════════════════════════════════════
// 采集（ingest）
// ════════════════════════════════════════════════════════════════════════════

export interface IngestReqCtx { ip: string; ua: string; siteKey?: string | null; origin?: string | null }
type NormalizedTrackEvent = TrackEventInput & { eventId: string };
let legacyEventsWithoutId = 0;

class SiteQuotaExceededError extends Error {}

export function getLegacyEventsWithoutIdCount(): number {
  return legacyEventsWithoutId;
}

const CLIENT_TS_MAX_SKEW_MS = 24 * 3600_000;

/** 采用客户端时间戳（离线重放保真），偏差超 ±24h 视为不可信回退服务器时间。 */
function resolveEventTime(ts: number | undefined): Date | undefined {
  if (!ts) return undefined;
  if (Math.abs(Date.now() - ts) > CLIENT_TS_MAX_SKEW_MS) return undefined;
  return new Date(ts);
}

export function resolveDistinctId(e: TrackEventInput, userId: number | null, memberId?: number | null): string {
  if (userId != null) return `u:${userId}`;
  if (memberId != null) return `m:${memberId}`;
  if (e.distinctId && !e.distinctId.startsWith('u:') && !e.distinctId.startsWith('m:')) return e.distinctId.slice(0, 64);
  if (e.anonymousId) return e.anonymousId.slice(0, 64);
  return e.sessionId;
}

function firstQualityEventName(events: TrackEventInput[]): string {
  const named = events.find((event) => event.eventName)?.eventName;
  return named ?? events[0]?.eventType ?? 'unknown';
}

async function recordSiteRejection(site: ResolvedAnalyticsSite, events: TrackEventInput[], issueType: 'origin_rejected' | 'quota_exceeded'): Promise<void> {
  const tenantId = site.tenantId ?? 0;
  const eventName = firstQualityEventName(events);
  await recordQualityIssue(tenantId, eventName, issueType).catch((err) => {
    logger.warn('[analytics] record site rejection quality issue failed', err);
  });
}

interface IngestIdentityCtx {
  tenantId: number | null;
  userId: number | null;
  memberId: number | null;
  displayName: string | null;
  hasAdmin: boolean;
  hasMember: boolean;
  env: ReturnType<typeof parseClientEnv>;
  geo: ReturnType<typeof lookupIpGeo>;
  storedIp: string;
  ua: string;
  site: ResolvedAnalyticsSite | null;
}

/** 组装单条事件的入库行：身份 / 平台字段解析在此统一收口，供 session/画像聚合复用同一份解析结果。 */
function buildIngestRow(e: NormalizedTrackEvent, ctx: IngestIdentityCtx) {
  const platform = resolveIngestPlatformFields(e, { hasAdmin: ctx.hasAdmin, hasMember: ctx.hasMember });
  if (!ctx.hasAdmin && !ctx.hasMember && ctx.site) platform.appId = ctx.site.appId;
  const eventTime = resolveEventTime(e.ts);
  return {
    eventId: e.eventId,
    tenantId: ctx.tenantId,
    distinctId: resolveDistinctId(e, ctx.userId, ctx.memberId),
    anonymousId: e.anonymousId ?? null,
    userId: ctx.userId,
    username: ctx.displayName,
    sessionId: e.sessionId,
    eventType: e.eventType,
    eventName: e.eventName ?? null,
    pagePath: e.pagePath,
    pageTitle: e.pageTitle ?? null,
    elementKey: e.elementKey ?? null,
    elementLabel: e.elementLabel ?? null,
    componentArea: e.componentArea ?? null,
    clickX: e.clickX ?? null,
    clickY: e.clickY ?? null,
    scrollDepth: e.scrollDepth ?? null,
    durationMs: e.durationMs ?? null,
    properties: e.properties ?? null,
    referrer: e.referrer ?? null,
    utmSource: e.utmSource ?? null,
    utmMedium: e.utmMedium ?? null,
    utmCampaign: e.utmCampaign ?? null,
    utmTerm: e.utmTerm ?? null,
    utmContent: e.utmContent ?? null,
    browser: ctx.env.browser,
    browserVersion: ctx.env.browserVersion,
    os: ctx.env.os,
    osVersion: ctx.env.osVersion,
    deviceType: ctx.env.deviceType,
    screenW: e.screenW ?? null,
    screenH: e.screenH ?? null,
    language: e.language ?? null,
    userAgent: ctx.ua.slice(0, 512),
    ip: ctx.storedIp,
    country: ctx.geo.country,
    region: ctx.geo.region,
    city: ctx.geo.city,
    metricName: e.metricName ?? null,
    metricValue: e.metricValue ?? null,
    source: platform.source,
    appId: platform.appId,
    environment: platform.environment,
    sdkVersion: e.sdkVersion ?? null,
    memberId: ctx.memberId,
    ...(eventTime ? { createdAt: eventTime } : {}),
  };
}

type IngestEventRow = ReturnType<typeof buildIngestRow>;

export async function batchInsertEvents(rawEvents: TrackEventInput[], reqCtx: IngestReqCtx): Promise<void> {
  if (rawEvents.length === 0) return;
  const user = currentUserOrNull();
  // 管理员 / 会员身份互斥：单次请求只会经过其中一种认证中间件
  const member = user ? undefined : currentMemberOrNull();
  const site = (!user && !member) ? await resolveSiteByKey(reqCtx.siteKey).catch(() => null) : null;
  if (site && !isSiteOriginAllowed(reqCtx.origin, site.allowedOrigins)) {
    await recordSiteRejection(site, rawEvents, 'origin_rejected');
    return;
  }
  const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
  const trustedEvents = user || member ? rawEvents : rawEvents.filter((event) => event.eventType !== 'identify');

  // Tracking Plan 治理：全局屏蔽 / 租户禁用 / propertySchema 校验。必须在生成兜底 eventId、
  // 开启采集事务之前完成，否则拒收事件也会被落库或参与去重。治理故障 best-effort 降级为全部放行。
  const { accepted: governedEvents, pendingSchemaIssues } = await evaluateEvents(trustedEvents, tenantId).catch(
    () => ({ accepted: trustedEvents, pendingSchemaIssues: [] as PendingSchemaIssue[] }),
  );
  const legacyCount = governedEvents.filter((event) => !event.eventId).length;
  if (legacyCount > 0) {
    legacyEventsWithoutId += legacyCount;
    logger.warn('[analytics] accepted legacy events without eventId', { batchCount: legacyCount, totalCount: legacyEventsWithoutId });
  }
  // 记录治理判定时引用的原始事件对象 -> 最终落库 eventId 的映射，供落库后按 fresh 行门控质量计数，
  // 避免客户端重放/重试重复计数（onConflictDoNothing 去重的行不应重复计数 schema 问题）。
  const finalEventIdByRef = new Map<TrackEventInput, string>();
  const events: NormalizedTrackEvent[] = governedEvents.map((event) => {
    const eventId = event.eventId ?? randomUUID();
    finalEventIdByRef.set(event, eventId);
    return { ...event, eventId };
  });
  if (events.length === 0) return;

  const env = parseClientEnv(reqCtx.ua);
  const geo = lookupIpGeo(reqCtx.ip); // 先地理解析，再按策略匿名化存储
  const { anonymizeIp } = await getIngestPolicy(tenantId).catch(() => ({ anonymizeIp: false }));
  const storedIp = (anonymizeIp ? anonymizeIpAddr(reqCtx.ip) : reqCtx.ip).slice(0, 64);
  const identityType: AnalyticsIdentityType = user ? 'admin' : member ? 'member' : 'anonymous';
  const displayName = user?.username ?? member?.identifier ?? null;

  const identityCtx: IngestIdentityCtx = {
    tenantId,
    userId: user?.userId ?? null,
    memberId: member?.memberId ?? null,
    displayName,
    hasAdmin: !!user,
    hasMember: !!member,
    env,
    geo,
    storedIp,
    ua: reqCtx.ua,
    site,
  };
  const rows: IngestEventRow[] = events.map((e) => buildIngestRow(e, identityCtx));

  // 前向身份合并：匿名批次中命中 identity_map 的事件，入库前把 distinctId 改写为权威身份，
  // 让同一真人的后续匿名浏览（清了 token 但 anonymousId 未变）直接归属既有身份
  if (!user && !member) {
    const anonIds = [...new Set(rows.map((r) => r.anonymousId).filter((v): v is string => !!v))];
    if (anonIds.length > 0) {
      const mappings = await resolveAnonymousMappings(anonIds, tenantId).catch(() => new Map<string, { distinctId: string }>());
      if (mappings.size > 0) {
        for (const row of rows) {
          const mapped = row.anonymousId ? mappings.get(row.anonymousId) : undefined;
          if (mapped) row.distinctId = mapped.distinctId;
        }
      }
    }
  }

  let insertedEvents: NormalizedTrackEvent[];
  let consumedQuotaCount = 0;
  try {
    insertedEvents = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(userEvents)
        .values(rows)
        .onConflictDoNothing({ target: userEvents.eventId })
        .returning({ eventId: userEvents.eventId });
      const insertedIds = new Set(inserted.flatMap((row) => row.eventId ? [row.eventId] : []));
      const freshEvents = events.filter((event) => insertedIds.has(event.eventId));
      const freshRows = rows.filter((row) => insertedIds.has(row.eventId));
      if (site?.dailyEventQuota != null && freshEvents.length > 0) {
        const quota = await checkAndConsumeSiteQuota(site.id, site.dailyEventQuota, freshEvents.length);
        if (!quota.allowed) throw new SiteQuotaExceededError();
        consumedQuotaCount = freshEvents.length;
      }
      await upsertSessions(tx, freshRows, { tenantId, userId: identityCtx.userId, memberId: identityCtx.memberId, username: displayName, env, geo });
      await upsertUserProfiles(tx, freshRows, { identityType, userId: identityCtx.userId, memberId: identityCtx.memberId, displayName });
      return freshEvents;
    });
  } catch (err) {
    if (err instanceof SiteQuotaExceededError && site) {
      await recordSiteRejection(site, events, 'quota_exceeded');
      return;
    }
    if (site && consumedQuotaCount > 0) await refundSiteQuota(site.id, consumedQuotaCount);
    throw err;
  }
  if (pendingSchemaIssues.length > 0) {
    // 只对真正新鲜落库（未被 onConflictDoNothing 去重）的事件计入质量问题，避免重放批次重复计数
    const freshEventIds = new Set(insertedEvents.map((e) => e.eventId));
    const freshPending = pendingSchemaIssues.filter((p) => {
      const finalId = finalEventIdByRef.get(p.event);
      return finalId !== undefined && freshEventIds.has(finalId);
    });
    await Promise.allSettled(
      freshPending.map((p) => recordSchemaIssues(p.tenantId, p.event.eventName as string, p.issues)),
    );
  }
  if (insertedEvents.length === 0) return;

  // 回溯身份合并：$identify 落库后，把该匿名 ID 的历史事件 / 会话 / 画像并入权威身份。
  // best-effort：失败仅记日志，下次 identify 幂等重试，不阻塞采集响应。
  if (user || member) {
    const identifyAnonIds = [...new Set(
      insertedEvents
        .filter((e) => e.eventType === 'identify' && e.anonymousId)
        .map((e) => e.anonymousId as string),
    )];
    if (identifyAnonIds.length > 0) {
      const canonical = member ? `m:${member.memberId}` : `u:${user!.userId}`;
      const bindings: IdentityBinding[] = identifyAnonIds.map((anonymousId) => ({
        tenantId,
        anonymousId,
        distinctId: canonical,
        identityType: member ? 'member' : 'admin',
        userId: user?.userId ?? null,
        memberId: member?.memberId ?? null,
        displayName,
      }));
      void processIdentityBindings(bindings);
    }
  }

  // 事件字典登记（best-effort，不阻塞）
  void touchEventMeta(insertedEvents, tenantId).catch(() => { /* ignore */ });
  notifyIngest(insertedEvents.length);
}

// 实时看板推送：节流广播「有新事件」信号，前端收到后即时刷新（轮询兜底仍在）
let lastIngestBroadcastAt = 0;
const INGEST_BROADCAST_MIN_INTERVAL_MS = 5000;

function notifyIngest(count: number): void {
  const nowMs = Date.now();
  if (nowMs - lastIngestBroadcastAt < INGEST_BROADCAST_MIN_INTERVAL_MS) return;
  lastIngestBroadcastAt = nowMs;
  try { broadcast({ type: 'analytics:ingest', payload: { count } }); } catch { /* ignore */ }
}

async function upsertSessions(
  executor: DbExecutor,
  rows: IngestEventRow[],
  ctx: {
    tenantId: number | null;
    userId: number | null;
    memberId: number | null;
    username: string | null;
    env: ReturnType<typeof parseClientEnv>;
    geo: ReturnType<typeof lookupIpGeo>;
  },
): Promise<void> {
  interface Agg {
    events: number;
    pageviews: number;
    firstPage: string;
    lastPage: string;
    referrer: string | null;
    utmSource: string | null;
    source: AnalyticsEventSource;
    appId: string;
    environment: AnalyticsEnvironment;
  }
  const bySession = new Map<string, Agg>();
  for (const r of rows) {
    // 首事件优先：会话的平台字段取该会话在本批次中的第一条事件，不被后续事件覆盖
    const cur = bySession.get(r.sessionId) ?? {
      events: 0, pageviews: 0, firstPage: r.pagePath, lastPage: r.pagePath, referrer: r.referrer, utmSource: r.utmSource,
      source: r.source, appId: r.appId, environment: r.environment,
    };
    cur.events += 1;
    if (r.eventType === 'page_view') cur.pageviews += 1;
    cur.lastPage = r.pagePath;
    bySession.set(r.sessionId, cur);
  }

  const now = new Date();
  const identityDistinctId = ctx.memberId != null ? `m:${ctx.memberId}` : ctx.userId != null ? `u:${ctx.userId}` : null;
  const values = [...bySession].map(([sessionId, s]) => ({
    tenantId: ctx.tenantId,
    sessionId,
    distinctId: identityDistinctId ?? sessionId,
    userId: ctx.userId,
    username: ctx.username,
    memberId: ctx.memberId,
    source: s.source,
    appId: s.appId,
    environment: s.environment,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    pageCount: s.pageviews,
    eventCount: s.events,
    entryPage: s.firstPage,
    exitPage: s.lastPage,
    referrer: s.referrer,
    utmSource: s.utmSource,
    browser: ctx.env.browser,
    os: ctx.env.os,
    deviceType: ctx.env.deviceType,
    country: ctx.geo.country,
    region: ctx.geo.region,
    isBounce: s.pageviews <= 1,
  }));
  if (values.length === 0) return;

  // 单条多值 UPSERT：LEAST/GREATEST 防批次乱序导致起止时间倒挂
  // 注意：source/appId/environment 只在会话首次创建时写入，冲突更新时不覆盖，
  // 与「会话平台字段 = 会话生命周期内首个事件」的口径保持一致
  await executor
    .insert(analyticsSessions)
    .values(values)
    .onConflictDoUpdate({
      target: analyticsSessions.sessionId,
      set: {
        startedAt: sql`LEAST(${analyticsSessions.startedAt}, excluded.started_at)`,
        endedAt: sql`GREATEST(${analyticsSessions.endedAt}, excluded.ended_at)`,
        exitPage: sql`excluded.exit_page`,
        pageCount: sql`${analyticsSessions.pageCount} + excluded.page_count`,
        eventCount: sql`${analyticsSessions.eventCount} + excluded.event_count`,
        durationMs: sql`GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(${analyticsSessions.endedAt}, excluded.ended_at) - LEAST(${analyticsSessions.startedAt}, excluded.started_at))) * 1000)::integer`,
        isBounce: sql`(${analyticsSessions.pageCount} + excluded.page_count) <= 1`,
        userId: sql`COALESCE(${analyticsSessions.userId}, excluded.user_id)`,
        username: sql`COALESCE(${analyticsSessions.username}, excluded.username)`,
        memberId: sql`COALESCE(${analyticsSessions.memberId}, excluded.member_id)`,
      },
    });
}

/**
 * 行为中心阶段 1：统一用户画像 upsert（tenant + distinctId 唯一）。
 *
 * 唯一索引为表达式索引（coalesce(tenant_id, 0), distinct_id），Drizzle 的
 * onConflictDoUpdate 难以直接指定该 target；改用「插入忽略冲突 + 逐条更新」，
 * 竞态安全：并发请求即使同时插入也不会因唯一键冲突而报错，更新语句在插入是否
 * 命中冲突的两种情形下都会执行，保证画像最终一致。
 */
async function upsertUserProfiles(
  executor: DbExecutor,
  rows: IngestEventRow[],
  identity: { identityType: AnalyticsIdentityType; userId: number | null; memberId: number | null; displayName: string | null },
): Promise<void> {
  // 首事件优先：同一批次同一 distinctId 只取第一条事件的平台字段写入画像属性
  const byDistinct = new Map<string, IngestEventRow>();
  for (const row of rows) {
    if (!byDistinct.has(row.distinctId)) byDistinct.set(row.distinctId, row);
  }
  if (byDistinct.size === 0) return;

  const values: ProfileUpsertInput[] = [...byDistinct.values()].map((row) => ({
    tenantId: row.tenantId,
    distinctId: row.distinctId,
    identityType: identity.identityType,
    userId: identity.userId,
    memberId: identity.memberId,
    displayName: identity.displayName,
    properties: { source: row.source, appId: row.appId, environment: row.environment } as Record<string, unknown>,
  }));

  await upsertUserProfilesBatch(executor, values);
}

// ════════════════════════════════════════════════════════════════════════════
// 概览 / 趋势
// ════════════════════════════════════════════════════════════════════════════

function pctDelta(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export interface OverviewRangeInput { days?: unknown; startDate?: string; endDate?: string }

/** 解析统计区间：优先自定义 startDate/endDate（含端点日），否则最近 N 天滚动窗口。 */
function resolveRange(input: OverviewRangeInput): { start: Date; endExclusive: Date; rangeMs: number } {
  const startParsed = input.startDate ? parseDateRangeStart(input.startDate) : null;
  const endParsed = input.endDate ? parseDateRangeEnd(input.endDate) : null;
  if (startParsed && endParsed && endParsed > startParsed) {
    const endExclusive = new Date(Math.min(endParsed.getTime() + 1, Date.now()));
    return { start: startParsed, endExclusive, rangeMs: endExclusive.getTime() - startParsed.getTime() };
  }
  const days = clampDays(input.days, 30);
  const now = new Date();
  const start = startOfDaysAgo(days);
  return { start, endExclusive: now, rangeMs: now.getTime() - start.getTime() };
}

export async function getOverview(input: OverviewRangeInput) {
  const { start, endExclusive, rangeMs } = resolveRange(input);
  const now = new Date();
  const prevStart = new Date(start.getTime() - rangeMs);
  const priorUserEvents = alias(userEvents, 'prior_user_events');

  const evScope = (s: Date, e: Date) =>
    buildWhere(and(gte(userEvents.createdAt, s), lt(userEvents.createdAt, e)), tenantScope(userEvents));
  const sessScope = (s: Date, e: Date) =>
    buildWhere(and(gte(analyticsSessions.startedAt, s), lt(analyticsSessions.startedAt, e)), tenantScope(analyticsSessions));

  const eventAgg = (s: Date, e: Date) =>
    db
      .select({
        pv: sql<number>`COUNT(*) FILTER (WHERE ${userEvents.eventType} = 'page_view')::int`,
        uv: countDistinct(userEvents.distinctId),
        events: sql<number>`COUNT(*)::int`,
        sessions: countDistinct(userEvents.sessionId),
      })
      .from(userEvents)
      .where(evScope(s, e));

  const sessionAgg = (s: Date, e: Date) =>
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        bounce: sql<number>`COUNT(*) FILTER (WHERE ${analyticsSessions.isBounce})::int`,
        avgDuration: sql<number | null>`AVG(${analyticsSessions.durationMs})::int`,
        avgPages: sql<number | null>`AVG(${analyticsSessions.pageCount})::numeric(10,2)`,
      })
      .from(analyticsSessions)
      .where(sessScope(s, e));

  const [cur, prev, sessCur, newUsersRow, activeRow] = await Promise.all([
    eventAgg(start, endExclusive),
    eventAgg(prevStart, start),
    sessionAgg(start, endExclusive),
    db
      .select({ n: countDistinct(userEvents.distinctId) })
      .from(userEvents)
      .where(
        buildWhere(
          and(
            gte(userEvents.createdAt, start),
            lt(userEvents.createdAt, endExclusive),
            isNotNull(userEvents.distinctId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(priorUserEvents)
                .where(and(
                  lt(priorUserEvents.createdAt, start),
                  eq(priorUserEvents.distinctId, userEvents.distinctId),
                  sql`${priorUserEvents.tenantId} IS NOT DISTINCT FROM ${userEvents.tenantId}`,
                )),
            ),
          ),
          tenantScope(userEvents),
        ),
      ),
    db
      .select({ n: countDistinct(userEvents.distinctId) })
      .from(userEvents)
      .where(buildWhere(gte(userEvents.createdAt, new Date(now.getTime() - 5 * 60_000)), tenantScope(userEvents))),
  ]);

  const c = cur[0];
  const p = prev[0];
  const sc = sessCur[0];
  const bounceRate = sc.total > 0 ? Math.round((Number(sc.bounce) / Number(sc.total)) * 1000) / 10 : 0;

  // 上一周期跳出率
  const [sessPrev] = await sessionAgg(prevStart, start);
  const prevBounce = Number(sessPrev.total) > 0 ? (Number(sessPrev.bounce) / Number(sessPrev.total)) * 100 : 0;

  return {
    pv: Number(c.pv),
    uv: Number(c.uv),
    sessions: Number(c.sessions),
    events: Number(c.events),
    newUsers: Number(newUsersRow[0]?.n ?? 0),
    avgSessionMs: Number(sc.avgDuration ?? 0),
    bounceRate,
    avgPagesPerSession: Number(sc.avgPages ?? 0),
    pvDelta: pctDelta(Number(c.pv), Number(p.pv)),
    uvDelta: pctDelta(Number(c.uv), Number(p.uv)),
    sessionsDelta: pctDelta(Number(c.sessions), Number(p.sessions)),
    bounceRateDelta: Math.round((bounceRate - prevBounce) * 10) / 10,
    activeNow: Number(activeRow[0]?.n ?? 0),
  };
}

const DAY_MS = 86_400_000;

/**
 * 近 5 分钟活跃的登录管理员数（与实时看板 activeNow 同窗口，只数登录用户）。
 * 供首页 dashboard「当前在线」使用，替代 Redis 令牌会话计数
 * （令牌会话在重复登录/未登出时持续累积，数值与真实在线严重背离）。
 */
export async function getActiveAdminUserCount(): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(userEvents.userId) })
    .from(userEvents)
    .where(buildWhere(
      and(gte(userEvents.createdAt, new Date(Date.now() - 5 * 60_000)), isNotNull(userEvents.userId)),
      tenantScope(userEvents),
    ));
  return Number(row?.n ?? 0);
}

export function dateAxis(days: number): string[] {
  const arr: string[] = [];
  const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
  const firstDay = todayStart.getTime() - (days - 1) * DAY_MS;
  for (let i = 0; i < days; i++) {
    arr.push(formatDate(new Date(firstDay + i * DAY_MS)));
  }
  return arr;
}

const TREND_METRICS = ['pv', 'uv', 'sessions', 'events'] as const;
type TrendMetric = (typeof TREND_METRICS)[number];
type TrendPoint = Record<TrendMetric, number>;

/** 起止日期（含端点）展开为日期轴，超长自动截断。 */
function dateAxisRange(startDate: string, endDate: string, maxDays = 365): string[] {
  const start = parseDateRangeStart(startDate);
  const end = parseDateRangeStart(endDate);
  if (!start || !end || end < start) return [];
  const n = Math.min(Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1, maxDays);
  return Array.from({ length: n }, (_, i) => formatDate(new Date(start.getTime() + i * DAY_MS)));
}

/** 按日期轴取每日指标：历史完整日读预聚合，今天与缺失日期回退原始表。 */
async function trendPointsForDates(dates: string[]): Promise<Map<string, TrendPoint>> {
  const byDay = new Map<string, TrendPoint>();
  if (dates.length === 0) return byDay;
  const today = formatDate(new Date());
  const endExclusive = parseDateRangeEnd(dates[dates.length - 1]) ?? new Date();

  const rollupRows = await db
    .select({
      statDate: analyticsDailyRollup.statDate,
      metric: analyticsDailyRollup.metric,
      value: sql<number>`SUM(${analyticsDailyRollup.value})`,
    })
    .from(analyticsDailyRollup)
    .where(buildWhere(
      and(
        eq(analyticsDailyRollup.dimType, 'overall'),
        gte(analyticsDailyRollup.statDate, dates[0]),
        lte(analyticsDailyRollup.statDate, dates[dates.length - 1]),
        inArray(analyticsDailyRollup.metric, [...TREND_METRICS]),
      ),
      rollupTenantScope(),
    ))
    .groupBy(analyticsDailyRollup.statDate, analyticsDailyRollup.metric);

  for (const r of rollupRows) {
    const item = byDay.get(r.statDate) ?? { pv: 0, uv: 0, sessions: 0, events: 0 };
    item[r.metric as TrendMetric] = Number(r.value);
    byDay.set(r.statDate, item);
  }

  const missing = dates.filter((d) => d === today || !byDay.has(d));
  if (missing.length > 0) {
    const rawStart = parseDateRangeStart(missing[0]) ?? new Date();
    const where = buildWhere(
      and(gte(userEvents.createdAt, rawStart), lt(userEvents.createdAt, endExclusive)),
      tenantScope(userEvents),
    );
    const rows = await db
      .select({
        day: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'YYYY-MM-DD')`,
        pv: sql<number>`COUNT(*) FILTER (WHERE ${userEvents.eventType} = 'page_view')::int`,
        uv: countDistinct(userEvents.distinctId),
        sessions: countDistinct(userEvents.sessionId),
        events: sql<number>`COUNT(*)::int`,
      })
      .from(userEvents)
      .where(where)
      .groupBy(sql`1`);

    const missingSet = new Set(missing);
    for (const r of rows) {
      if (!missingSet.has(r.day)) continue;
      byDay.set(r.day, { pv: Number(r.pv), uv: Number(r.uv), sessions: Number(r.sessions), events: Number(r.events) });
    }
  }
  return byDay;
}

function buildTrendSeries(dates: string[], byDay: Map<string, TrendPoint>) {
  const pick = (key: TrendMetric) => dates.map((d) => Number(byDay.get(d)?.[key] ?? 0));
  return [
    { key: 'pv', name: '浏览量(PV)', data: pick('pv') },
    { key: 'uv', name: '访客数(UV)', data: pick('uv') },
    { key: 'sessions', name: '会话数', data: pick('sessions') },
    { key: 'events', name: '事件数', data: pick('events') },
  ];
}

export interface TrendsInput { days?: unknown; startDate?: string; endDate?: string; compare?: boolean }

export async function getTrends(input: TrendsInput) {
  const dates = input.startDate && input.endDate
    ? dateAxisRange(input.startDate, input.endDate)
    : dateAxis(clampDays(input.days, 30));
  if (dates.length === 0) return { dates: [], series: buildTrendSeries([], new Map()) };

  const byDay = await trendPointsForDates(dates);
  const result: {
    dates: string[];
    series: ReturnType<typeof buildTrendSeries>;
    compare?: { dates: string[]; series: ReturnType<typeof buildTrendSeries> };
  } = { dates, series: buildTrendSeries(dates, byDay) };

  if (input.compare) {
    // 上一周期：紧邻的等长区间
    const firstStart = parseDateRangeStart(dates[0]) ?? new Date();
    const prevDates = Array.from({ length: dates.length }, (_, i) =>
      formatDate(new Date(firstStart.getTime() - (dates.length - i) * DAY_MS)));
    const prevByDay = await trendPointsForDates(prevDates);
    result.compare = { dates: prevDates, series: buildTrendSeries(prevDates, prevByDay) };
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// 页面停留 / 功能使用 / 热力图 / 用户统计
// ════════════════════════════════════════════════════════════════════════════

const ANALYTICS_PAGE_SIZE_MAX = 200;

/** 分页入参归一：页码/页长兜底并夹紧上界，避免 pageSize=100000 打穿一次查询 */
function normalizePageQuery(q: { page?: number; pageSize?: number }): { page: number; pageSize: number } {
  const page = Math.max(1, Math.trunc(Number(q.page) || 1));
  const pageSize = Math.min(Math.max(1, Math.trunc(Number(q.pageSize) || 20)), ANALYTICS_PAGE_SIZE_MAX);
  return { page, pageSize };
}

/**
 * 分组总数：分页列表的 total 必须是**分组后的行数**，而不是 db.$count 的原始事件数。
 * 直接用事件数会让页码算多出十几倍，翻到后面全是空页。
 */
async function countGroups(groupExpr: SQL, where?: SQL): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT 1 FROM ${userEvents} ${where ? sql`WHERE ${where}` : sql``} GROUP BY ${groupExpr}
    ) g
  `)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

function countDistinctGroups(column: PgColumn, where?: SQL): Promise<number> {
  return countGroups(sql`${column}`, where);
}

export interface PageStatsQuery { days?: number; page?: number; pageSize?: number }
export async function getPageStats(q: PageStatsQuery) {
  const days = clampDays(q.days, 30);
  const { page, pageSize } = normalizePageQuery(q);
  const start = startOfDaysAgo(days);
  const where = buildWhere(
    and(eq(userEvents.eventType, 'page_leave'), isNotNull(userEvents.durationMs), gte(userEvents.createdAt, start)),
    tenantScope(userEvents),
  );

  const [rows, totals, total] = await Promise.all([
    withPagination(
      db
        .select({
          pagePath: userEvents.pagePath,
          pageTitle: sql<string | null>`MAX(${userEvents.pageTitle})`,
          visits: sql<number>`COUNT(*)::integer`,
          avgMs: sql<number | null>`ROUND(AVG(${userEvents.durationMs}))::integer`,
          medianMs: sql<number | null>`(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${userEvents.durationMs}))::integer`,
          p90Ms: sql<number | null>`(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ${userEvents.durationMs}))::integer`,
        })
        .from(userEvents)
        .where(where)
        .groupBy(userEvents.pagePath)
        .orderBy(sql`COUNT(*) DESC`, userEvents.pagePath)
        .$dynamic(),
      page,
      pageSize,
    ),
    db
      .select({
        totalVisits: sql<number>`COUNT(*)::int`,
        avgDwellMs: sql<number | null>`ROUND(AVG(${userEvents.durationMs}))::int`,
      })
      .from(userEvents)
      .where(where),
    countDistinctGroups(userEvents.pagePath, where),
  ]);

  const list = rows.map((r) => ({
    pagePath: r.pagePath,
    pageTitle: r.pageTitle,
    visits: Number(r.visits),
    avgMs: r.avgMs == null ? null : Number(r.avgMs),
    medianMs: r.medianMs == null ? null : Number(r.medianMs),
    p90Ms: r.p90Ms == null ? null : Number(r.p90Ms),
  }));
  return {
    list,
    total,
    page,
    pageSize,
    totalVisits: Number(totals[0]?.totalVisits ?? 0),
    avgDwellMs: totals[0]?.avgDwellMs == null ? null : Number(totals[0].avgDwellMs),
  };
}

export interface FeatureStatsQuery { days?: number; page?: number; pageSize?: number; pagePath?: string }
export async function getFeatureStats(q: FeatureStatsQuery) {
  const days = clampDays(q.days, 30);
  const { page, pageSize } = normalizePageQuery(q);
  const start = startOfDaysAgo(days);
  const conditions = [eq(userEvents.eventType, 'feature_use'), isNotNull(userEvents.elementKey), gte(userEvents.createdAt, start)];
  if (q.pagePath) conditions.push(eq(userEvents.pagePath, q.pagePath));
  const where = buildWhere(...conditions, tenantScope(userEvents));

  const [rows, totalEvents, total] = await Promise.all([
    withPagination(
      db
        .select({
          pagePath: userEvents.pagePath,
          elementKey: sql<string>`MAX(${userEvents.elementKey})`,
          elementLabel: sql<string | null>`MAX(${userEvents.elementLabel})`,
          componentArea: sql<string | null>`MAX(${userEvents.componentArea})`,
          count: sql<number>`COUNT(*)::integer`,
        })
        .from(userEvents)
        .where(where)
        .groupBy(userEvents.pagePath, userEvents.elementKey)
        .orderBy(sql`COUNT(*) DESC`, userEvents.pagePath)
        .$dynamic(),
      page,
      pageSize,
    ),
    db.$count(userEvents, where),
    countGroups(sql`${userEvents.pagePath}, ${userEvents.elementKey}`, where),
  ]);

  const list = rows.map((r) => ({
    pagePath: r.pagePath,
    elementKey: r.elementKey,
    elementLabel: r.elementLabel,
    componentArea: r.componentArea,
    count: Number(r.count),
  }));
  return { list, total, page, pageSize, totalEvents };
}

const HEATMAP_EVENT_TYPES = ['area_click', 'feature_use'] as const;
const HEATMAP_BINS = 50;
const HEATMAP_BIN_SIZE = 100 / HEATMAP_BINS;
const HEATMAP_TOP_ELEMENT_LIMIT = 10;
const HEATMAP_RAGE_CLICK_LIMIT = 10;

export interface HeatmapQuery {
  pagePath: string;
  componentArea?: string;
  days?: number;
  deviceType?: AnalyticsDeviceType;
  source?: AnalyticsEventSource;
}

export async function getHeatmapData(q: HeatmapQuery) {
  const days = clampDays(q.days, 30);
  const start = startOfDaysAgo(days);
  // 页面级基础条件：设备/来源筛选同时作用于点击落点与挫败点击。
  // 落点坐标是视口百分比，桌面与移动端混算会让分布失真，因此设备筛选是正确性需求而非装饰。
  const pageConditions = [eq(userEvents.pagePath, q.pagePath), gte(userEvents.createdAt, start)];
  if (q.deviceType) pageConditions.push(eq(userEvents.deviceType, q.deviceType));
  if (q.source) pageConditions.push(eq(userEvents.source, q.source));

  // componentArea 为空 = 全页模式：聚合该页所有带坐标的点击（含 autocapture 视口坐标）
  const clickConditions = [
    ...pageConditions,
    inArray(userEvents.eventType, [...HEATMAP_EVENT_TYPES]),
    isNotNull(userEvents.clickX),
    isNotNull(userEvents.clickY),
  ];
  if (q.componentArea) clickConditions.push(eq(userEvents.componentArea, q.componentArea));
  const clickWhere = buildWhere(...clickConditions, tenantScope(userEvents));

  // 元素排行不依赖坐标（与「功能使用」统计同口径）：无坐标的点击也计入榜单，
  // avgX/avgY 仅对有坐标的行取平均（FILTER），全部无坐标时为 null
  const elementConditions = [
    ...pageConditions,
    inArray(userEvents.eventType, [...HEATMAP_EVENT_TYPES]),
    isNotNull(userEvents.elementKey),
  ];
  if (q.componentArea) elementConditions.push(eq(userEvents.componentArea, q.componentArea));
  const elementWhere = buildWhere(...elementConditions, tenantScope(userEvents));

  const binX = sql<number>`LEAST(FLOOR(${userEvents.clickX} / ${HEATMAP_BIN_SIZE}), ${HEATMAP_BINS - 1})::int`;
  const binY = sql<number>`LEAST(FLOOR(${userEvents.clickY} / ${HEATMAP_BIN_SIZE}), ${HEATMAP_BINS - 1})::int`;
  // 分组内出现最多的取值；MODE 对 NULL 的处理依版本而异，显式 FILTER 保证只统计非空行
  const dominant = (col: PgColumn) =>
    sql<string | null>`MODE() WITHIN GROUP (ORDER BY ${col}) FILTER (WHERE ${col} IS NOT NULL)`;
  const dominantLabel = dominant(userEvents.elementLabel);

  const [binRows, totalRows, elementRows, rageRows] = await Promise.all([
    // 分箱在 SQL 侧完成：旧实现取前 5000 行再内存分箱，数据量大时会静默丢点。
    // GROUP BY 用序号引用 select 列：drizzle 在 select 与 groupBy 中渲染的列限定不一致，
    // 重复表达式会被 PG 判为「未出现在 GROUP BY 中」（42803）
    db
      .select({
        cx: binX,
        cy: binY,
        value: sql<number>`COUNT(*)::int`,
        uniqueUsers: countDistinct(userEvents.distinctId),
        topLabel: dominantLabel,
        topElementKey: dominant(userEvents.elementKey),
        topArea: dominant(userEvents.componentArea),
      })
      .from(userEvents)
      .where(clickWhere)
      .groupBy(sql`1, 2`),
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        uniqueUsers: countDistinct(userEvents.distinctId),
        uniqueSessions: countDistinct(userEvents.sessionId),
      })
      .from(userEvents)
      .where(clickWhere),
    db
      .select({
        elementKey: userEvents.elementKey,
        elementLabel: dominantLabel,
        componentArea: sql<string | null>`MAX(${userEvents.componentArea})`,
        count: sql<number>`COUNT(*)::int`,
        uniqueUsers: countDistinct(userEvents.distinctId),
        avgX: sql<number | null>`ROUND(AVG(${userEvents.clickX}) FILTER (WHERE ${userEvents.clickX} IS NOT NULL)::numeric, 1)::float8`,
        avgY: sql<number | null>`ROUND(AVG(${userEvents.clickY}) FILTER (WHERE ${userEvents.clickY} IS NOT NULL)::numeric, 1)::float8`,
      })
      .from(userEvents)
      .where(elementWhere)
      .groupBy(userEvents.elementKey)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(HEATMAP_TOP_ELEMENT_LIMIT),
    // 挫败点击事件不带坐标与区域，只按页面 + 设备/来源筛选
    db
      .select({
        elementKey: userEvents.elementKey,
        elementLabel: dominantLabel,
        count: sql<number>`COUNT(*)::int`,
        uniqueUsers: countDistinct(userEvents.distinctId),
        lastAt: sql<Date | null>`MAX(${userEvents.createdAt})`,
      })
      .from(userEvents)
      .where(
        buildWhere(
          and(...pageConditions, eq(userEvents.eventType, 'custom'), eq(userEvents.eventName, ANALYTICS_RAGE_CLICK_EVENT)),
          tenantScope(userEvents),
        ),
      )
      .groupBy(userEvents.elementKey)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(HEATMAP_RAGE_CLICK_LIMIT),
  ]);

  // rage click 事件不带坐标，无法直接落到分箱；按主元素 key 关联，把榜单与落点图对上
  const rageElementKeys = new Set(rageRows.map((r) => r.elementKey).filter((key): key is string => !!key));

  const points = binRows.map((r) => {
    const value = Number(r.value);
    const binUsers = Number(r.uniqueUsers);
    return {
      x: Number(r.cx) * HEATMAP_BIN_SIZE + HEATMAP_BIN_SIZE / 2,
      y: Number(r.cy) * HEATMAP_BIN_SIZE + HEATMAP_BIN_SIZE / 2,
      value,
      topLabel: r.topLabel,
      topElementKey: r.topElementKey,
      topArea: r.topArea,
      uniqueUsers: binUsers,
      repeatRate: binUsers > 0 ? Math.round((value / binUsers) * 10) / 10 : 0,
      rage: !!r.topElementKey && rageElementKeys.has(r.topElementKey),
    };
  });

  const total = Number(totalRows[0]?.total ?? 0);
  const uniqueUsers = Number(totalRows[0]?.uniqueUsers ?? 0);
  const uniqueSessions = Number(totalRows[0]?.uniqueSessions ?? 0);

  return {
    pagePath: q.pagePath,
    componentArea: q.componentArea ?? '',
    points,
    total,
    uniqueUsers,
    uniqueSessions,
    avgClicksPerUser: uniqueUsers > 0 ? Math.round((total / uniqueUsers) * 10) / 10 : 0,
    topElements: elementRows.map((r) => ({
      elementKey: r.elementKey ?? '',
      elementLabel: r.elementLabel,
      componentArea: r.componentArea,
      count: Number(r.count),
      uniqueUsers: Number(r.uniqueUsers),
      avgX: r.avgX == null ? null : Number(r.avgX),
      avgY: r.avgY == null ? null : Number(r.avgY),
    })),
    rageClicks: rageRows.map((r) => ({
      elementKey: r.elementKey,
      elementLabel: r.elementLabel,
      count: Number(r.count),
      uniqueUsers: Number(r.uniqueUsers),
      lastAt: formatNullableDateTime(r.lastAt),
    })),
  };
}

export interface HeatmapPageListQuery { days?: number }
export async function getHeatmapPageList(q: HeatmapPageListQuery) {
  const days = clampDays(q.days, 30);
  const start = startOfDaysAgo(days);
  const where = buildWhere(
    and(inArray(userEvents.eventType, [...HEATMAP_EVENT_TYPES]), isNotNull(userEvents.clickX), isNotNull(userEvents.pagePath), gte(userEvents.createdAt, start)),
    tenantScope(userEvents),
  );
  const rows = await db
    .select({ pagePath: userEvents.pagePath, pageTitle: sql<string | null>`MAX(${userEvents.pageTitle})`, componentArea: userEvents.componentArea })
    .from(userEvents)
    .where(where)
    .groupBy(userEvents.pagePath, userEvents.componentArea)
    .orderBy(userEvents.pagePath);

  const pageMap = new Map<string, { pagePath: string; pageTitle: string | null; areas: Set<string> }>();
  for (const r of rows) {
    if (!pageMap.has(r.pagePath)) pageMap.set(r.pagePath, { pagePath: r.pagePath, pageTitle: r.pageTitle, areas: new Set() });
    if (r.componentArea) pageMap.get(r.pagePath)!.areas.add(r.componentArea);
  }
  return { pages: Array.from(pageMap.values()).map((p) => ({ pagePath: p.pagePath, pageTitle: p.pageTitle, areas: Array.from(p.areas) })) };
}

export interface UserStatsQuery { days?: number; page?: number; pageSize?: number }
export async function getUserStats(q: UserStatsQuery) {
  const days = clampDays(q.days, 30);
  const { page, pageSize } = normalizePageQuery(q);
  const start = startOfDaysAgo(days);
  const where = buildWhere(gte(userEvents.createdAt, start), tenantScope(userEvents));

  const [rows, totalRows] = await Promise.all([
    withPagination(
      db
        .select({
          userId: userEvents.userId,
          username: userEvents.username,
          totalEvents: sql<number>`COUNT(*)::integer`,
          pageViews: sql<number>`SUM(CASE WHEN ${userEvents.eventType} = 'page_view' THEN 1 ELSE 0 END)::integer`,
          uniquePages: countDistinct(userEvents.pagePath),
          featureUses: sql<number>`SUM(CASE WHEN ${userEvents.eventType} = 'feature_use' THEN 1 ELSE 0 END)::integer`,
          totalDwellMs: sql<number | null>`SUM(CASE WHEN ${userEvents.eventType} = 'page_leave' THEN ${userEvents.durationMs} ELSE NULL END)::bigint`,
          lastActiveAt: sql<Date | null>`MAX(${userEvents.createdAt})`,
        })
        .from(userEvents)
        .where(where)
        .groupBy(userEvents.userId, userEvents.username)
        .orderBy(sql`COUNT(*) DESC`, userEvents.userId)
        .$dynamic(),
      page,
      pageSize,
    ),
    db
      .select({
        total: sql<number>`COUNT(DISTINCT (COALESCE(${userEvents.userId}::text, 'anonymous') || ':' || COALESCE(${userEvents.username}, '')))::int`,
      })
      .from(userEvents)
      .where(where),
  ]);

  const list = rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    totalEvents: Number(r.totalEvents),
    pageViews: Number(r.pageViews),
    uniquePages: Number(r.uniquePages),
    featureUses: Number(r.featureUses),
    totalDwellMs: r.totalDwellMs == null ? null : Number(r.totalDwellMs),
    lastActiveAt: formatNullableDateTime(r.lastActiveAt),
  }));
  return { list, total: Number(totalRows[0]?.total ?? 0), page, pageSize };
}

// ════════════════════════════════════════════════════════════════════════════
// 会话列表
// ════════════════════════════════════════════════════════════════════════════

export interface SessionListQuery { page?: number; pageSize?: number; username?: string; deviceType?: string }
export async function listSessions(q: SessionListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  conditions.push(keywordCondition(q.username, [analyticsSessions.username]));
  if (q.deviceType) conditions.push(eq(analyticsSessions.deviceType, q.deviceType as 'desktop'));
  const where = buildWhere(...conditions, tenantScope(analyticsSessions));

  const [list, total] = await Promise.all([
    db
      .select()
      .from(analyticsSessions)
      .where(where)
      .orderBy(desc(analyticsSessions.startedAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(analyticsSessions, where),
  ]);

  return {
    list: list.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      userId: r.userId,
      username: r.username,
      startedAt: formatDateTime(r.startedAt),
      endedAt: formatDateTime(r.endedAt),
      durationMs: r.durationMs,
      pageCount: r.pageCount,
      eventCount: r.eventCount,
      entryPage: r.entryPage,
      exitPage: r.exitPage,
      referrer: r.referrer,
      browser: r.browser,
      os: r.os,
      deviceType: r.deviceType,
      region: r.region,
      isBounce: r.isBounce,
      memberId: r.memberId,
      source: r.source,
      appId: r.appId,
      environment: r.environment,
    })),
    total,
    page,
    pageSize,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 漏斗 / 留存分析已迁移至 analytics-conversion.service.ts（有序转化漏斗 + 双口径留存）
// ════════════════════════════════════════════════════════════════════════════
// 路径分析（页面跳转 Sankey）
// ════════════════════════════════════════════════════════════════════════════

const PATH_LINK_LIMIT_DEFAULT = 30;

/**
 * 路径分析：聚合会话内**全部相邻跳转**（页面级节点）。
 *
 * 不做会话步序锚定 —— 后台 SPA 一个会话常有几十次跳转，按「会话第 N 步」截断会让
 * 除开头几步之外的所有跳转永远不可见。
 *
 * 代价是跳转图天然带环（`/ ⇄ /profile` 互跳），而桑基布局无法表达回边，
 * 因此这里用 DFS 挑出一组反馈弧标记 `cyclic`：图只渲染非回边，明细表仍是完整数据。
 */
export async function getPathAnalysis(input: { days?: number; limit?: number; startPage?: string }) {
  const days = clampDays(input.days, 30);
  const limit = clampLimit(input.limit, PATH_LINK_LIMIT_DEFAULT, 100);
  const start = startOfDaysAgo(days);
  // sessionId 为空的事件无法还原会话内顺序，纳入会把不相关访问串成假路径
  const where = buildWhere(
    and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, start), isNotNull(userEvents.sessionId)),
    tenantScope(userEvents),
  )!;

  const rows = (await db.execute(sql`
    WITH seq AS (
      SELECT ${userEvents.sessionId} AS session_id,
             ${userEvents.pagePath} AS page_path,
             ROW_NUMBER() OVER (PARTITION BY ${userEvents.sessionId} ORDER BY ${userEvents.createdAt}, ${userEvents.id}) AS rn,
             LAG(${userEvents.pagePath}) OVER (PARTITION BY ${userEvents.sessionId} ORDER BY ${userEvents.createdAt}, ${userEvents.id}) AS prev_page
      FROM ${userEvents}
      WHERE ${where}
    ),
    cleaned AS (
      -- 折叠连续重复页面（刷新、局部跳转），否则会产生自环
      SELECT session_id, page_path, rn
      FROM seq
      WHERE prev_page IS NULL OR prev_page <> page_path
    ),
    pairs AS (
      SELECT page_path AS source,
             LEAD(page_path) OVER (PARTITION BY session_id ORDER BY rn) AS next_page
      FROM cleaned
    )
    -- 会话在此结束（next_page 为空）归入退出节点：丢掉这部分流量会让桑基图凭空变细
    SELECT source, COALESCE(next_page, ${ANALYTICS_PATH_EXIT_PAGE}) AS target, COUNT(*)::int AS value
    FROM pairs
    GROUP BY 1, 2
    ORDER BY value DESC, source, target
  `)) as unknown as Array<{ source: string; target: string; value: number }>;

  const allLinks = rows.map((r) => ({ source: r.source, target: r.target, value: Number(r.value) }));
  const totalTransitions = allLinks.reduce((sum, l) => sum + l.value, 0);

  const scoped = input.startPage ? reachableFrom(allLinks, input.startPage) : allLinks;
  const kept = scoped.slice(0, limit);
  const cyclicSet = findFeedbackArcs(kept);

  const nodeAcc = new Map<string, { id: string; out: number; in: number }>();
  const touch = (id: string) => {
    let node = nodeAcc.get(id);
    if (!node) {
      node = { id, out: 0, in: 0 };
      nodeAcc.set(id, node);
    }
    return node;
  };
  const links = kept.map((l) => {
    touch(l.source).out += l.value;
    touch(l.target).in += l.value;
    return { ...l, cyclic: cyclicSet.has(linkKey(l)) };
  });

  const nodes = [...nodeAcc.values()]
    // 节点体量取进出流量的较大值：入口没有入流、退出没有出流，取和会让两端偏小
    .map((n) => ({ id: n.id, label: n.id, value: Math.max(n.out, n.in) }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));

  return {
    nodes,
    links,
    totalTransitions,
    cyclicValue: links.filter((l) => l.cyclic).reduce((sum, l) => sum + l.value, 0),
  };
}

interface RawPathLink { source: string; target: string; value: number }

function linkKey(l: RawPathLink): string {
  return `${l.source}\u0000${l.target}`;
}

/** 从起点页出发按前向边可达的子图（含起点自身的出边） */
function reachableFrom(links: readonly RawPathLink[], startPage: string): RawPathLink[] {
  const outgoing = new Map<string, RawPathLink[]>();
  for (const l of links) {
    const bucket = outgoing.get(l.source);
    if (bucket) bucket.push(l);
    else outgoing.set(l.source, [l]);
  }
  const seen = new Set<string>([startPage]);
  const queue = [startPage];
  const picked: RawPathLink[] = [];
  while (queue.length > 0) {
    for (const l of outgoing.get(queue.shift()!) ?? []) {
      picked.push(l);
      if (!seen.has(l.target)) {
        seen.add(l.target);
        queue.push(l.target);
      }
    }
  }
  return picked;
}

/**
 * 挑一组反馈弧（回边），移除后剩余图必然无环。
 *
 * 用 Eades–Lin–Smyth 贪心：反复摘掉汇点（排到队尾）与源点（排到队头），
 * 都没有时取「出流 − 入流」最大的节点排到队头；最后按该线性序，凡是从后指向前的边即回边。
 *
 * 不用朴素 DFS：像 /analytics/behavior 这种进出都很重的枢纽页会被 DFS 最先访问，
 * 于是所有回指它的边统统变成回边（实测 55 次跳转里被判掉 13 次，近四分之一流量凭空消失）。
 * 贪心序会把枢纽排在中间，两侧的边各自成为前向边。
 */
function findFeedbackArcs(links: readonly RawPathLink[]): Set<string> {
  const remaining = new Set<string>();
  for (const l of links) {
    remaining.add(l.source);
    remaining.add(l.target);
  }

  const outW = new Map<string, number>();
  const inW = new Map<string, number>();
  const recompute = () => {
    outW.clear();
    inW.clear();
    for (const id of remaining) {
      outW.set(id, 0);
      inW.set(id, 0);
    }
    for (const l of links) {
      if (!remaining.has(l.source) || !remaining.has(l.target)) continue;
      outW.set(l.source, (outW.get(l.source) ?? 0) + l.value);
      inW.set(l.target, (inW.get(l.target) ?? 0) + l.value);
    }
  };

  const head: string[] = [];
  const tail: string[] = [];
  while (remaining.size > 0) {
    recompute();
    const sinks = [...remaining].filter((id) => (outW.get(id) ?? 0) === 0);
    if (sinks.length > 0) {
      for (const id of sinks) {
        tail.unshift(id);
        remaining.delete(id);
      }
      continue;
    }
    const sources = [...remaining].filter((id) => (inW.get(id) ?? 0) === 0);
    if (sources.length > 0) {
      for (const id of sources) {
        head.push(id);
        remaining.delete(id);
      }
      continue;
    }
    let best = '';
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const id of remaining) {
      const score = (outW.get(id) ?? 0) - (inW.get(id) ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    head.push(best);
    remaining.delete(best);
  }

  const order = new Map([...head, ...tail].map((id, index) => [id, index]));
  const back = new Set<string>();
  for (const l of links) {
    if ((order.get(l.source) ?? 0) >= (order.get(l.target) ?? 0)) back.add(linkKey(l));
  }
  return back;
}

// ════════════════════════════════════════════════════════════════════════════
// 用户行为时间线
// ════════════════════════════════════════════════════════════════════════════

export async function getUserTimeline(input: { userId?: number; username?: string; limit?: number }) {
  const limit = clampLimit(input.limit, 100, 500);
  const conditions = [];
  if (input.userId != null) conditions.push(eq(userEvents.userId, input.userId));
  if (input.username) conditions.push(eq(userEvents.username, input.username));
  const where = buildWhere(...conditions, tenantScope(userEvents));

  const [rows, summary] = await Promise.all([
    db
      .select({
        id: userEvents.id,
        eventType: userEvents.eventType,
        eventName: userEvents.eventName,
        pagePath: userEvents.pagePath,
        pageTitle: userEvents.pageTitle,
        elementLabel: userEvents.elementLabel,
        componentArea: userEvents.componentArea,
        durationMs: userEvents.durationMs,
        sessionId: userEvents.sessionId,
        properties: userEvents.properties,
        createdAt: userEvents.createdAt,
        userId: userEvents.userId,
        username: userEvents.username,
      })
      .from(userEvents)
      .where(where)
      .orderBy(desc(userEvents.createdAt))
      .limit(limit),
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        first: sql<Date | null>`MIN(${userEvents.createdAt})`,
        last: sql<Date | null>`MAX(${userEvents.createdAt})`,
      })
      .from(userEvents)
      .where(where),
  ]);

  return {
    userId: input.userId ?? rows[0]?.userId ?? null,
    username: input.username ?? rows[0]?.username ?? null,
    totalEvents: Number(summary[0]?.total ?? 0),
    firstSeenAt: formatNullableDateTime(summary[0]?.first ?? null),
    lastSeenAt: formatNullableDateTime(summary[0]?.last ?? null),
    items: rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      eventName: r.eventName,
      pagePath: r.pagePath,
      pageTitle: r.pageTitle,
      elementLabel: r.elementLabel,
      componentArea: r.componentArea,
      durationMs: r.durationMs,
      sessionId: r.sessionId,
      properties: r.properties ?? null,
      createdAt: formatDateTime(r.createdAt),
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 会话时间轴（单会话事件序列回放）
// ════════════════════════════════════════════════════════════════════════════

export async function getSessionTimeline(sessionId: string, limitRaw?: number) {
  const limit = clampLimit(limitRaw, 300, 1000);
  const [session] = await db
    .select()
    .from(analyticsSessions)
    .where(buildWhere(eq(analyticsSessions.sessionId, sessionId), tenantScope(analyticsSessions)))
    .limit(1);

  const rows = await db
    .select({
      id: userEvents.id,
      eventType: userEvents.eventType,
      eventName: userEvents.eventName,
      pagePath: userEvents.pagePath,
      pageTitle: userEvents.pageTitle,
      elementLabel: userEvents.elementLabel,
      componentArea: userEvents.componentArea,
      durationMs: userEvents.durationMs,
      properties: userEvents.properties,
      createdAt: userEvents.createdAt,
    })
    .from(userEvents)
    .where(buildWhere(eq(userEvents.sessionId, sessionId), tenantScope(userEvents)))
    .orderBy(userEvents.createdAt, userEvents.id)
    .limit(limit);

  return {
    sessionId,
    username: session?.username ?? null,
    userId: session?.userId ?? null,
    startedAt: session ? formatDateTime(session.startedAt) : null,
    durationMs: session?.durationMs ?? null,
    entryPage: session?.entryPage ?? null,
    deviceType: session?.deviceType ?? null,
    browser: session?.browser ?? null,
    os: session?.os ?? null,
    items: rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      eventName: r.eventName,
      pagePath: r.pagePath,
      pageTitle: r.pageTitle,
      elementLabel: r.elementLabel,
      componentArea: r.componentArea,
      durationMs: r.durationMs,
      properties: r.properties ?? null,
      createdAt: formatDateTime(r.createdAt),
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 性能（Web Vitals）
// ════════════════════════════════════════════════════════════════════════════

export async function getPerfStats(daysRaw: unknown) {
  const days = clampDays(daysRaw, 30);
  const start = startOfDaysAgo(days);
  const where = buildWhere(
    and(eq(userEvents.eventType, 'perf'), isNotNull(userEvents.metricName), isNotNull(userEvents.metricValue), gte(userEvents.createdAt, start)),
    tenantScope(userEvents),
  );
  const rows = await db
    .select({
      metricName: userEvents.metricName,
      count: sql<number>`COUNT(*)::int`,
      avg: sql<number | null>`ROUND(AVG(${userEvents.metricValue})::numeric, 2)`,
      p75: sql<number | null>`ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${userEvents.metricValue}))::numeric, 2)`,
      p90: sql<number | null>`ROUND((PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${userEvents.metricValue}))::numeric, 2)`,
      p99: sql<number | null>`ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${userEvents.metricValue}))::numeric, 2)`,
    })
    .from(userEvents)
    .where(where)
    .groupBy(userEvents.metricName);

  const { perfRating } = await import('../../lib/analytics-helpers');
  return {
    items: rows.map((r) => {
      const p75 = r.p75 == null ? null : Number(r.p75);
      return {
        metricName: r.metricName ?? '',
        count: Number(r.count),
        avg: r.avg == null ? null : Number(r.avg),
        p75,
        p90: r.p90 == null ? null : Number(r.p90),
        p99: r.p99 == null ? null : Number(r.p99),
        rating: perfRating(r.metricName ?? '', p75 ?? 0),
      };
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 实时
// ════════════════════════════════════════════════════════════════════════════

export async function getRealtime() {
  const now = Date.now();
  const last5 = new Date(now - 5 * 60_000);
  const last30 = new Date(now - 30 * 60_000);
  const last1 = new Date(now - 60_000);

  const [active, pv30, ev1, topPages, recent, perMin] = await Promise.all([
    db.select({ n: countDistinct(userEvents.distinctId) }).from(userEvents).where(buildWhere(gte(userEvents.createdAt, last5), tenantScope(userEvents))),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(userEvents).where(buildWhere(and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, last30)), tenantScope(userEvents))),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(userEvents).where(buildWhere(gte(userEvents.createdAt, last1), tenantScope(userEvents))),
    db
      .select({ pagePath: userEvents.pagePath, pageTitle: sql<string | null>`MAX(${userEvents.pageTitle})`, active: countDistinct(userEvents.sessionId) })
      .from(userEvents)
      .where(buildWhere(and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, last30)), tenantScope(userEvents)))
      .groupBy(userEvents.pagePath)
      .orderBy(sql`COUNT(DISTINCT ${userEvents.sessionId}) DESC`)
      .limit(8),
    db
      .select({ eventType: userEvents.eventType, eventName: userEvents.eventName, pagePath: userEvents.pagePath, username: userEvents.username, createdAt: userEvents.createdAt })
      .from(userEvents)
      .where(buildWhere(gte(userEvents.createdAt, last30), tenantScope(userEvents)))
      .orderBy(desc(userEvents.createdAt))
      .limit(20),
    db
      .select({ minute: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'HH24:MI')`, events: sql<number>`COUNT(*)::int` })
      .from(userEvents)
      .where(buildWhere(gte(userEvents.createdAt, last30), tenantScope(userEvents)))
      .groupBy(sql`1`)
      .orderBy(sql`min(${userEvents.createdAt})`),
  ]);

  return {
    activeUsers: Number(active[0]?.n ?? 0),
    pageViewsLast30Min: Number(pv30[0]?.n ?? 0),
    eventsLastMinute: Number(ev1[0]?.n ?? 0),
    topPages: topPages.map((p) => ({ pagePath: p.pagePath, pageTitle: p.pageTitle, active: Number(p.active) })),
    recentEvents: recent.map((r) => ({ eventType: r.eventType, eventName: r.eventName, pagePath: r.pagePath, username: r.username, createdAt: formatDateTime(r.createdAt) })),
    perMinute: perMin.map((m) => ({ minute: m.minute, events: Number(m.events) })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 事件列表 / 详情 / 清理
// ════════════════════════════════════════════════════════════════════════════

export interface EventListQuery {
  page?: number;
  pageSize?: number;
  eventType?: UserBehaviorEventType;
  eventName?: string;
  username?: string;
  pagePath?: string;
  deviceType?: string;
  startTime?: Date;
  endTime?: Date;
}

function buildEventListWhere(q: EventListQuery) {
  const conditions = [];
  if (q.eventType) conditions.push(eq(userEvents.eventType, q.eventType));
  if (q.eventName) conditions.push(eq(userEvents.eventName, q.eventName));
  conditions.push(keywordCondition(q.username, [userEvents.username]));
  conditions.push(keywordCondition(q.pagePath, [userEvents.pagePath]));
  if (q.deviceType) conditions.push(eq(userEvents.deviceType, q.deviceType as 'desktop'));
  if (q.startTime) conditions.push(gte(userEvents.createdAt, q.startTime));
  if (q.endTime) conditions.push(lt(userEvents.createdAt, q.endTime));
  return buildWhere(...conditions, tenantScope(userEvents));
}

export async function listAnalyticsEvents(q: EventListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const where = buildEventListWhere(q);

  const [list, total] = await Promise.all([
    db
      .select({
        id: userEvents.id,
        userId: userEvents.userId,
        username: userEvents.username,
        eventType: userEvents.eventType,
        eventName: userEvents.eventName,
        pagePath: userEvents.pagePath,
        pageTitle: userEvents.pageTitle,
        elementKey: userEvents.elementKey,
        elementLabel: userEvents.elementLabel,
        componentArea: userEvents.componentArea,
        durationMs: userEvents.durationMs,
        browser: userEvents.browser,
        os: userEvents.os,
        deviceType: userEvents.deviceType,
        region: userEvents.region,
        sessionId: userEvents.sessionId,
        createdAt: userEvents.createdAt,
        memberId: userEvents.memberId,
        source: userEvents.source,
        appId: userEvents.appId,
        environment: userEvents.environment,
        properties: userEvents.properties,
      })
      .from(userEvents)
      .where(where)
      .orderBy(desc(userEvents.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(userEvents, where),
  ]);

  return {
    list: list.map(({ properties, ...r }) => {
      // $api 事件行内摘要：免去逐条点开详情排查接口问题
      const props = (properties ?? null) as { url?: unknown; status?: unknown } | null;
      const isApi = r.eventType === 'api_request';
      return {
        ...r,
        createdAt: formatDateTime(r.createdAt),
        apiUrl: isApi && typeof props?.url === 'string' ? props.url.slice(0, 512) : null,
        apiStatus: isApi && typeof props?.status === 'number' ? props.status : null,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function getEventDetail(id: number) {
  const where = buildWhere(eq(userEvents.id, id), tenantScope(userEvents));
  const [r] = await db.select().from(userEvents).where(where).limit(1);
  if (!r) return null;
  return {
    id: r.id,
    userId: r.userId,
    username: r.username,
    eventType: r.eventType,
    eventName: r.eventName,
    pagePath: r.pagePath,
    pageTitle: r.pageTitle,
    elementKey: r.elementKey,
    elementLabel: r.elementLabel,
    componentArea: r.componentArea,
    durationMs: r.durationMs,
    browser: r.browser,
    os: r.os,
    deviceType: r.deviceType,
    region: r.region,
    sessionId: r.sessionId,
    createdAt: formatDateTime(r.createdAt),
    distinctId: r.distinctId,
    anonymousId: r.anonymousId,
    scrollDepth: r.scrollDepth,
    properties: r.properties ?? null,
    referrer: r.referrer,
    utmSource: r.utmSource,
    utmMedium: r.utmMedium,
    utmCampaign: r.utmCampaign,
    browserVersion: r.browserVersion,
    osVersion: r.osVersion,
    screenW: r.screenW,
    screenH: r.screenH,
    language: r.language,
    userAgent: r.userAgent,
    ip: r.ip,
    country: r.country,
    city: r.city,
    metricName: r.metricName,
    metricValue: r.metricValue,
    memberId: r.memberId,
    source: r.source,
    appId: r.appId,
    environment: r.environment,
    sdkVersion: r.sdkVersion,
  };
}

export async function listEventsForExport(q: EventListQuery, max = 50_000) {
  const where = buildEventListWhere(q);
  const rows = await db
    .select({
      id: userEvents.id,
      username: userEvents.username,
      eventType: userEvents.eventType,
      eventName: userEvents.eventName,
      pagePath: userEvents.pagePath,
      pageTitle: userEvents.pageTitle,
      elementLabel: userEvents.elementLabel,
      componentArea: userEvents.componentArea,
      durationMs: userEvents.durationMs,
      browser: userEvents.browser,
      os: userEvents.os,
      deviceType: userEvents.deviceType,
      region: userEvents.region,
      createdAt: userEvents.createdAt,
      memberId: userEvents.memberId,
      source: userEvents.source,
      appId: userEvents.appId,
      environment: userEvents.environment,
    })
    .from(userEvents)
    .where(where)
    .orderBy(desc(userEvents.createdAt))
    .limit(max);
  return rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) }));
}

export async function countEventsForExport(q: EventListQuery, max = 50_000): Promise<number> {
  return Math.min(await db.$count(userEvents, buildEventListWhere(q)), max);
}

export async function cleanAnalyticsEvents(days: number): Promise<number> {
  const where =
    days > 0
      ? buildWhere(sql`${userEvents.createdAt} < NOW() - (${days} * INTERVAL '1 day')`, tenantScope(userEvents))
      : tenantScope(userEvents);
  const result = await db.delete(userEvents).where(where);
  // 一并清理过期会话
  if (days > 0) {
    await db.delete(analyticsSessions).where(buildWhere(sql`${analyticsSessions.startedAt} < NOW() - (${days} * INTERVAL '1 day')`, tenantScope(analyticsSessions)));
  } else {
    await db.delete(analyticsSessions).where(tenantScope(analyticsSessions));
  }
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
