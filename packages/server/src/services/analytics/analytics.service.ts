import { and, eq, gte, lt, lte, isNotNull, sql, countDistinct, desc, like, notExists, inArray } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { db } from '../../db';
import { userEvents, analyticsSessions, analyticsDailyRollup } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { TrackEventInput, UserBehaviorEventType, AnalyticsEventSource, AnalyticsEnvironment, AnalyticsIdentityType } from '@zenith/shared';
import { currentUserOrNull } from '../../lib/context';
import { currentMemberOrNull } from '../../lib/member-context';
import { tenantScope, getCreateTenantId } from '../../lib/tenant';
import { mergeWhere, escapeLike } from '../../lib/where-helpers';
import { formatNullableDateTime, formatDateTime, formatDate, APP_TIME_ZONE, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { parseClientEnv, lookupIpGeo, clampDays, clampLimit, startOfDaysAgo, anonymizeIpAddr, resolveIngestPlatformFields } from '../../lib/analytics-helpers';
import { touchEventMeta } from './analytics-event-meta.service';
import { upsertUserProfilesBatch, type ProfileUpsertInput } from './analytics-profile.service';
import { evaluateEvents, recordQualityIssue, recordSchemaIssues, type PendingSchemaIssue } from './analytics-governance.service';
import { getIngestPolicy } from './analytics-settings.service';
import { isSiteOriginAllowed, resolveSiteByKey, type ResolvedAnalyticsSite } from './analytics-sites.service';
import { checkAndConsumeSiteQuota, refundSiteQuota } from './analytics-quota.service';
import { rollupTenantScope, ROLLUP_DIM_TYPES } from './analytics-rollup.service';
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
    mergeWhere(and(gte(userEvents.createdAt, s), lt(userEvents.createdAt, e)), tenantScope(userEvents));
  const sessScope = (s: Date, e: Date) =>
    mergeWhere(and(gte(analyticsSessions.startedAt, s), lt(analyticsSessions.startedAt, e)), tenantScope(analyticsSessions));

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
        mergeWhere(
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
      .where(mergeWhere(gte(userEvents.createdAt, new Date(now.getTime() - 5 * 60_000)), tenantScope(userEvents))),
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
    .where(mergeWhere(
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
    const where = mergeWhere(
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

export interface PageStatsQuery { days?: number; limit?: number }
export async function getPageStats(q: PageStatsQuery) {
  const days = clampDays(q.days, 30);
  const limit = clampLimit(q.limit, 20);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(
    and(eq(userEvents.eventType, 'page_leave'), isNotNull(userEvents.durationMs), gte(userEvents.createdAt, start)),
    tenantScope(userEvents),
  );

  const [rows, totals] = await Promise.all([
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
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit),
    db
      .select({
        totalVisits: sql<number>`COUNT(*)::int`,
        avgDwellMs: sql<number | null>`ROUND(AVG(${userEvents.durationMs}))::int`,
      })
      .from(userEvents)
      .where(where),
  ]);

  const items = rows.map((r) => ({
    pagePath: r.pagePath,
    pageTitle: r.pageTitle,
    visits: Number(r.visits),
    avgMs: r.avgMs == null ? null : Number(r.avgMs),
    medianMs: r.medianMs == null ? null : Number(r.medianMs),
    p90Ms: r.p90Ms == null ? null : Number(r.p90Ms),
  }));
  return {
    items,
    totalVisits: Number(totals[0]?.totalVisits ?? 0),
    avgDwellMs: totals[0]?.avgDwellMs == null ? null : Number(totals[0].avgDwellMs),
  };
}

export interface FeatureStatsQuery { days?: number; limit?: number; pagePath?: string }
export async function getFeatureStats(q: FeatureStatsQuery) {
  const days = clampDays(q.days, 30);
  const limit = clampLimit(q.limit, 30);
  const start = startOfDaysAgo(days);
  const conditions = [eq(userEvents.eventType, 'feature_use'), isNotNull(userEvents.elementKey), gte(userEvents.createdAt, start)];
  if (q.pagePath) conditions.push(eq(userEvents.pagePath, q.pagePath));
  const where = mergeWhere(and(...conditions), tenantScope(userEvents));

  const [rows, totalEvents] = await Promise.all([
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
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit),
    db.$count(userEvents, where),
  ]);

  const items = rows.map((r) => ({
    pagePath: r.pagePath,
    elementKey: r.elementKey,
    elementLabel: r.elementLabel,
    componentArea: r.componentArea,
    count: Number(r.count),
  }));
  return { items, totalEvents };
}

const HEATMAP_EVENT_TYPES = ['area_click', 'feature_use'] as const;

export interface HeatmapQuery { pagePath: string; componentArea?: string; days?: number }
export async function getHeatmapData(q: HeatmapQuery) {
  const days = clampDays(q.days, 30);
  const start = startOfDaysAgo(days);
  // componentArea 为空 = 全页模式：聚合该页所有带坐标的点击（含 autocapture 视口坐标）
  const conditions = [
    inArray(userEvents.eventType, [...HEATMAP_EVENT_TYPES]),
    eq(userEvents.pagePath, q.pagePath),
    isNotNull(userEvents.clickX),
    isNotNull(userEvents.clickY),
    gte(userEvents.createdAt, start),
  ];
  if (q.componentArea) conditions.push(eq(userEvents.componentArea, q.componentArea));
  const where = mergeWhere(and(...conditions), tenantScope(userEvents));
  const rows = await db.select({ x: userEvents.clickX, y: userEvents.clickY }).from(userEvents).where(where).limit(5000);

  const BINS = 50;
  const cellMap = new Map<string, number>();
  for (const r of rows) {
    if (r.x == null || r.y == null) continue;
    const cx = Math.min(Math.floor((r.x / 100) * BINS), BINS - 1);
    const cy = Math.min(Math.floor((r.y / 100) * BINS), BINS - 1);
    const key = `${cx},${cy}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1);
  }
  const points = Array.from(cellMap.entries()).map(([key, value]) => {
    const [cx, cy] = key.split(',').map(Number);
    return { x: (cx / BINS) * 100 + 100 / BINS / 2, y: (cy / BINS) * 100 + 100 / BINS / 2, value };
  });
  return { pagePath: q.pagePath, componentArea: q.componentArea ?? '', points, total: rows.length };
}

export interface HeatmapPageListQuery { days?: number }
export async function getHeatmapPageList(q: HeatmapPageListQuery) {
  const days = clampDays(q.days, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(
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

export interface UserStatsQuery { days?: number; limit?: number }
export async function getUserStats(q: UserStatsQuery) {
  const days = clampDays(q.days, 30);
  const limit = clampLimit(q.limit, 20);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(gte(userEvents.createdAt, start), tenantScope(userEvents));

  const [rows, totalRows] = await Promise.all([
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
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit),
    db
      .select({
        total: sql<number>`COUNT(DISTINCT (COALESCE(${userEvents.userId}::text, 'anonymous') || ':' || COALESCE(${userEvents.username}, '')))::int`,
      })
      .from(userEvents)
      .where(where),
  ]);

  const items = rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    totalEvents: Number(r.totalEvents),
    pageViews: Number(r.pageViews),
    uniquePages: Number(r.uniquePages),
    featureUses: Number(r.featureUses),
    totalDwellMs: r.totalDwellMs == null ? null : Number(r.totalDwellMs),
    lastActiveAt: formatNullableDateTime(r.lastActiveAt),
  }));
  return { items, totalUsers: Number(totalRows[0]?.total ?? 0) };
}

// ════════════════════════════════════════════════════════════════════════════
// 会话列表
// ════════════════════════════════════════════════════════════════════════════

export interface SessionListQuery { page?: number; pageSize?: number; username?: string; deviceType?: string }
export async function listSessions(q: SessionListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = clampLimit(q.pageSize, 20, 100);
  const conditions = [];
  if (q.username) conditions.push(like(analyticsSessions.username, `%${escapeLike(q.username)}%`));
  if (q.deviceType) conditions.push(eq(analyticsSessions.deviceType, q.deviceType as 'desktop'));
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(analyticsSessions));

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

export async function getPathAnalysis(input: { days?: number; limit?: number; startPage?: string }) {
  const days = clampDays(input.days, 30);
  const limit = clampLimit(input.limit, 12, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, start)), tenantScope(userEvents))!;
  const startFilter = input.startPage ? sql` AND seq.page_path = ${input.startPage}` : sql``;

  // LEAD 窗口函数在库内构造相邻跳转，替代全量拉取内存扫描
  const rows = (await db.execute(sql`
    WITH seq AS (
      SELECT ${userEvents.sessionId} AS session_id,
             ${userEvents.pagePath} AS page_path,
             LEAD(${userEvents.pagePath}) OVER (PARTITION BY ${userEvents.sessionId} ORDER BY ${userEvents.createdAt}, ${userEvents.id}) AS next_page
      FROM ${userEvents}
      WHERE ${where}
    )
    SELECT seq.page_path AS source, seq.next_page AS target, COUNT(*)::int AS value
    FROM seq
    WHERE seq.next_page IS NOT NULL AND seq.next_page <> seq.page_path${startFilter}
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ source: string; target: string; value: number }>;

  const nodeSet = new Set<string>();
  const links = rows.map((r) => {
    nodeSet.add(r.source);
    nodeSet.add(r.target);
    return { source: r.source, target: r.target, value: Number(r.value) };
  });
  const nodeValue = new Map<string, number>();
  for (const l of links) nodeValue.set(l.source, (nodeValue.get(l.source) ?? 0) + l.value);
  const nodes = [...nodeSet].map((id) => ({ id, label: id, value: nodeValue.get(id) ?? 0 }));
  return { nodes, links };
}

// ════════════════════════════════════════════════════════════════════════════
// 用户行为时间线
// ════════════════════════════════════════════════════════════════════════════

export async function getUserTimeline(input: { userId?: number; username?: string; limit?: number }) {
  const limit = clampLimit(input.limit, 100, 500);
  const conditions = [];
  if (input.userId != null) conditions.push(eq(userEvents.userId, input.userId));
  if (input.username) conditions.push(eq(userEvents.username, input.username));
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(userEvents));

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
    .where(mergeWhere(eq(analyticsSessions.sessionId, sessionId), tenantScope(analyticsSessions)))
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
    .where(mergeWhere(eq(userEvents.sessionId, sessionId), tenantScope(userEvents)))
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
// 维度分布（浏览器 / 系统 / 设备 / 地域 / 来源 / 页面）
// ════════════════════════════════════════════════════════════════════════════

const DIMENSION_COLUMN: Record<string, PgColumn> = {
  browser: userEvents.browser,
  os: userEvents.os,
  device: userEvents.deviceType,
  region: userEvents.region,
  source: userEvents.utmSource,
  referrer: userEvents.referrer,
  page: userEvents.pagePath,
};

export async function getDimensionBreakdown(input: { days?: number; dimension: string; limit?: number }) {
  const days = clampDays(input.days, 30);
  const limit = clampLimit(input.limit, 12, 50);
  const dimension = input.dimension in DIMENSION_COLUMN ? input.dimension : 'browser';
  const col = DIMENSION_COLUMN[dimension];
  const onlyPv = dimension === 'page';
  const dates = dateAxis(days);
  const today = dates[dates.length - 1];
  const unknownLabel = dimension === 'referrer' || dimension === 'source' ? '直接访问' : '未知';

  const counts = new Map<string, number>(); // key: 维度值（'' = NULL 哨兵）
  let total = 0;
  const coveredDays = new Set<string>();

  // ── 低基数维度历史日走预聚合（referrer/source 基数不可控，始终走 raw）────────
  if (ROLLUP_DIM_TYPES.has(dimension)) {
    const rows = await db
      .select({
        statDate: analyticsDailyRollup.statDate,
        dimValue: analyticsDailyRollup.dimValue,
        value: sql<number>`SUM(${analyticsDailyRollup.value})`,
      })
      .from(analyticsDailyRollup)
      .where(mergeWhere(
        and(eq(analyticsDailyRollup.dimType, dimension), gte(analyticsDailyRollup.statDate, dates[0])),
        rollupTenantScope(),
      ))
      .groupBy(analyticsDailyRollup.statDate, analyticsDailyRollup.dimValue);
    for (const r of rows) {
      coveredDays.add(r.statDate);
      counts.set(r.dimValue, (counts.get(r.dimValue) ?? 0) + Number(r.value));
      total += Number(r.value);
    }
  }

  // ── 今天与 rollup 未覆盖的日期回退原始表 ────────────────────────────────────
  const missing = dates.filter((d) => d === today || !coveredDays.has(d));
  if (missing.length > 0) {
    const rawStart = parseDateRangeStart(missing[0]) ?? startOfDaysAgo(days);
    const conditions = [gte(userEvents.createdAt, rawStart)];
    if (onlyPv) conditions.push(eq(userEvents.eventType, 'page_view'));
    const where = mergeWhere(and(...conditions), tenantScope(userEvents));
    const rows = await db
      .select({
        day: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'YYYY-MM-DD')`,
        name: sql<string | null>`${col}`,
        value: sql<number>`COUNT(*)::int`,
      })
      .from(userEvents)
      .where(where)
      .groupBy(sql`1`, col);
    const missingSet = new Set(missing);
    for (const r of rows) {
      if (!missingSet.has(r.day)) continue;
      const key = r.name ?? '';
      counts.set(key, (counts.get(key) ?? 0) + Number(r.value));
      total += Number(r.value);
    }
  }

  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({
      name: name || unknownLabel,
      value,
      percent: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
    }));
  return { dimension, total, items };
}

/** 双维交叉分布：dim1 取 Top N 行，dim2 取全局 Top 8 列（其余归入「其他」）。 */
export async function getDimensionCross(input: { days?: number; dim1: string; dim2: string; limit?: number }) {
  const days = clampDays(input.days, 30);
  const limit = clampLimit(input.limit, 10, 20);
  const dim1 = input.dim1 in DIMENSION_COLUMN ? input.dim1 : 'browser';
  const dim2 = input.dim2 in DIMENSION_COLUMN && input.dim2 !== dim1 ? input.dim2 : (dim1 === 'os' ? 'browser' : 'os');
  const col1 = DIMENSION_COLUMN[dim1];
  const col2 = DIMENSION_COLUMN[dim2];
  const start = startOfDaysAgo(days);
  const conditions = [gte(userEvents.createdAt, start)];
  if (dim1 === 'page' || dim2 === 'page') conditions.push(eq(userEvents.eventType, 'page_view'));
  const where = mergeWhere(and(...conditions), tenantScope(userEvents));

  const rows = await db
    .select({
      d1: sql<string | null>`${col1}`,
      d2: sql<string | null>`${col2}`,
      value: sql<number>`COUNT(*)::int`,
    })
    .from(userEvents)
    .where(where)
    .groupBy(col1, col2);

  const MAX_COLUMNS = 8;
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const r of rows) {
    const k1 = r.d1 ?? '未知';
    const k2 = r.d2 ?? '未知';
    rowTotals.set(k1, (rowTotals.get(k1) ?? 0) + Number(r.value));
    colTotals.set(k2, (colTotals.get(k2) ?? 0) + Number(r.value));
  }
  const topRows = [...rowTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
  const topCols = [...colTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLUMNS).map(([k]) => k);
  const hasOther = colTotals.size > topCols.length;
  const columns = hasOther ? [...topCols, '其他'] : topCols;

  const cells = new Map<string, number>();
  for (const r of rows) {
    const k1 = r.d1 ?? '未知';
    if (!topRows.includes(k1)) continue;
    const rawK2 = r.d2 ?? '未知';
    const k2 = topCols.includes(rawK2) ? rawK2 : '其他';
    const key = `${k1}\u0001${k2}`;
    cells.set(key, (cells.get(key) ?? 0) + Number(r.value));
  }

  return {
    dim1,
    dim2,
    columns,
    rows: topRows.map((name) => ({
      name,
      total: rowTotals.get(name) ?? 0,
      values: columns.map((c) => cells.get(`${name}\u0001${c}`) ?? 0),
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 性能（Web Vitals）
// ════════════════════════════════════════════════════════════════════════════

export async function getPerfStats(daysRaw: unknown) {
  const days = clampDays(daysRaw, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(
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
    db.select({ n: countDistinct(userEvents.distinctId) }).from(userEvents).where(mergeWhere(gte(userEvents.createdAt, last5), tenantScope(userEvents))),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(userEvents).where(mergeWhere(and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, last30)), tenantScope(userEvents))),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(userEvents).where(mergeWhere(gte(userEvents.createdAt, last1), tenantScope(userEvents))),
    db
      .select({ pagePath: userEvents.pagePath, pageTitle: sql<string | null>`MAX(${userEvents.pageTitle})`, active: countDistinct(userEvents.sessionId) })
      .from(userEvents)
      .where(mergeWhere(and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, last30)), tenantScope(userEvents)))
      .groupBy(userEvents.pagePath)
      .orderBy(sql`COUNT(DISTINCT ${userEvents.sessionId}) DESC`)
      .limit(8),
    db
      .select({ eventType: userEvents.eventType, eventName: userEvents.eventName, pagePath: userEvents.pagePath, username: userEvents.username, createdAt: userEvents.createdAt })
      .from(userEvents)
      .where(mergeWhere(gte(userEvents.createdAt, last30), tenantScope(userEvents)))
      .orderBy(desc(userEvents.createdAt))
      .limit(20),
    db
      .select({ minute: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'HH24:MI')`, events: sql<number>`COUNT(*)::int` })
      .from(userEvents)
      .where(mergeWhere(gte(userEvents.createdAt, last30), tenantScope(userEvents)))
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
  if (q.username) conditions.push(like(userEvents.username, `%${escapeLike(q.username)}%`));
  if (q.pagePath) conditions.push(like(userEvents.pagePath, `%${escapeLike(q.pagePath)}%`));
  if (q.deviceType) conditions.push(eq(userEvents.deviceType, q.deviceType as 'desktop'));
  if (q.startTime) conditions.push(gte(userEvents.createdAt, q.startTime));
  if (q.endTime) conditions.push(lt(userEvents.createdAt, q.endTime));
  return mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(userEvents));
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
      })
      .from(userEvents)
      .where(where)
      .orderBy(desc(userEvents.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(userEvents, where),
  ]);

  return { list: list.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) })), total, page, pageSize };
}

export async function getEventDetail(id: number) {
  const where = mergeWhere(eq(userEvents.id, id), tenantScope(userEvents));
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
      ? mergeWhere(sql`${userEvents.createdAt} < NOW() - (${days} * INTERVAL '1 day')`, tenantScope(userEvents))
      : tenantScope(userEvents);
  const result = await db.delete(userEvents).where(where);
  // 一并清理过期会话
  if (days > 0) {
    await db.delete(analyticsSessions).where(mergeWhere(sql`${analyticsSessions.startedAt} < NOW() - (${days} * INTERVAL '1 day')`, tenantScope(analyticsSessions)));
  } else {
    await db.delete(analyticsSessions).where(tenantScope(analyticsSessions));
  }
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
