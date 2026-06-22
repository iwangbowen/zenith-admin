import { and, eq, gte, lt, isNotNull, sql, countDistinct, desc, like } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { userEvents, analyticsSessions } from '../db/schema';
import type { TrackEventInput, UserBehaviorEventType } from '@zenith/shared';
import { currentUserOrNull } from '../lib/context';
import { tenantScope, getCreateTenantId } from '../lib/tenant';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { formatNullableDateTime, formatDateTime, formatDate, APP_TIME_ZONE } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { parseClientEnv, lookupIpGeo, clampDays, clampLimit, startOfDaysAgo } from '../lib/analytics-helpers';
import { touchEventMeta } from './analytics-event-meta.service';

// ════════════════════════════════════════════════════════════════════════════
// 采集（ingest）
// ════════════════════════════════════════════════════════════════════════════

export interface IngestReqCtx { ip: string; ua: string }

function resolveDistinctId(e: TrackEventInput, userId: number | null): string {
  if (e.distinctId) return e.distinctId.slice(0, 64);
  if (userId != null) return `u:${userId}`;
  if (e.anonymousId) return e.anonymousId.slice(0, 64);
  return e.sessionId;
}

export async function batchInsertEvents(events: TrackEventInput[], reqCtx: IngestReqCtx): Promise<void> {
  if (events.length === 0) return;
  const user = currentUserOrNull();
  const tenantId = user ? getCreateTenantId(user) : null;
  const env = parseClientEnv(reqCtx.ua);
  const geo = lookupIpGeo(reqCtx.ip);

  const rows = events.map((e) => ({
    tenantId,
    distinctId: resolveDistinctId(e, user?.userId ?? null),
    anonymousId: e.anonymousId ?? null,
    userId: user?.userId ?? null,
    username: user?.username ?? null,
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
    browser: env.browser,
    browserVersion: env.browserVersion,
    os: env.os,
    osVersion: env.osVersion,
    deviceType: env.deviceType,
    screenW: e.screenW ?? null,
    screenH: e.screenH ?? null,
    language: e.language ?? null,
    userAgent: reqCtx.ua.slice(0, 512),
    ip: reqCtx.ip.slice(0, 64),
    country: geo.country,
    region: geo.region,
    city: geo.city,
    metricName: e.metricName ?? null,
    metricValue: e.metricValue ?? null,
  }));

  await db.insert(userEvents).values(rows);
  await upsertSessions(events, { tenantId, userId: user?.userId ?? null, username: user?.username ?? null, env, geo });
  // 事件字典登记（best-effort，不阻塞）
  void touchEventMeta(events, tenantId).catch(() => { /* ignore */ });
}

async function upsertSessions(
  events: TrackEventInput[],
  ctx: {
    tenantId: number | null;
    userId: number | null;
    username: string | null;
    env: ReturnType<typeof parseClientEnv>;
    geo: ReturnType<typeof lookupIpGeo>;
  },
): Promise<void> {
  interface Agg { events: number; pageviews: number; firstPage: string; lastPage: string; referrer: string | null; utmSource: string | null }
  const bySession = new Map<string, Agg>();
  for (const e of events) {
    const cur = bySession.get(e.sessionId) ?? {
      events: 0, pageviews: 0, firstPage: e.pagePath, lastPage: e.pagePath, referrer: e.referrer ?? null, utmSource: e.utmSource ?? null,
    };
    cur.events += 1;
    if (e.eventType === 'page_view') cur.pageviews += 1;
    cur.lastPage = e.pagePath;
    bySession.set(e.sessionId, cur);
  }

  const now = new Date();
  for (const [sessionId, s] of bySession) {
    await db
      .insert(analyticsSessions)
      .values({
        tenantId: ctx.tenantId,
        sessionId,
        distinctId: ctx.userId != null ? `u:${ctx.userId}` : sessionId,
        userId: ctx.userId,
        username: ctx.username,
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
      })
      .onConflictDoUpdate({
        target: analyticsSessions.sessionId,
        set: {
          endedAt: now,
          exitPage: s.lastPage,
          pageCount: sql`${analyticsSessions.pageCount} + ${s.pageviews}`,
          eventCount: sql`${analyticsSessions.eventCount} + ${s.events}`,
          durationMs: sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ${analyticsSessions.startedAt})) * 1000)::integer`,
          isBounce: sql`(${analyticsSessions.pageCount} + ${s.pageviews}) <= 1`,
          userId: sql`COALESCE(${analyticsSessions.userId}, ${ctx.userId})`,
          username: sql`COALESCE(${analyticsSessions.username}, ${ctx.username})`,
        },
      });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 概览 / 趋势
// ════════════════════════════════════════════════════════════════════════════

function pctDelta(cur: number, prev: number): number {
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export async function getOverview(daysRaw: unknown) {
  const days = clampDays(daysRaw, 30);
  const now = new Date();
  const start = startOfDaysAgo(days);
  const prevStart = startOfDaysAgo(days * 2);

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
    eventAgg(start, now),
    eventAgg(prevStart, start),
    sessionAgg(start, now),
    db
      .select({ n: countDistinct(userEvents.distinctId) })
      .from(userEvents)
      .where(
        mergeWhere(
          and(
            gte(userEvents.createdAt, start),
            sql`${userEvents.distinctId} NOT IN (SELECT DISTINCT distinct_id FROM user_events WHERE created_at < ${start.toISOString()}::timestamptz AND distinct_id IS NOT NULL)`,
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

function dateAxis(days: number): string[] {
  const arr: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    arr.push(formatDate(d));
  }
  return arr;
}

export async function getTrends(daysRaw: unknown) {
  const days = clampDays(daysRaw, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(gte(userEvents.createdAt, start), tenantScope(userEvents));

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
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const dates = dateAxis(days);
  const pick = (key: 'pv' | 'uv' | 'sessions' | 'events') => dates.map((d) => Number(byDay.get(d)?.[key] ?? 0));

  return {
    dates,
    series: [
      { key: 'pv', name: '浏览量(PV)', data: pick('pv') },
      { key: 'uv', name: '访客数(UV)', data: pick('uv') },
      { key: 'sessions', name: '会话数', data: pick('sessions') },
      { key: 'events', name: '事件数', data: pick('events') },
    ],
  };
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

  const rows = await db
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
    .limit(limit);

  const items = rows.map((r) => ({
    pagePath: r.pagePath,
    pageTitle: r.pageTitle,
    visits: Number(r.visits),
    avgMs: r.avgMs == null ? null : Number(r.avgMs),
    medianMs: r.medianMs == null ? null : Number(r.medianMs),
    p90Ms: r.p90Ms == null ? null : Number(r.p90Ms),
  }));
  return { items, totalVisits: items.reduce((s, i) => s + i.visits, 0) };
}

export interface FeatureStatsQuery { days?: number; limit?: number; pagePath?: string }
export async function getFeatureStats(q: FeatureStatsQuery) {
  const days = clampDays(q.days, 30);
  const limit = clampLimit(q.limit, 30);
  const start = startOfDaysAgo(days);
  const conditions = [eq(userEvents.eventType, 'feature_use'), isNotNull(userEvents.elementKey), gte(userEvents.createdAt, start)];
  if (q.pagePath) conditions.push(eq(userEvents.pagePath, q.pagePath));
  const where = mergeWhere(and(...conditions), tenantScope(userEvents));

  const rows = await db
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
    .limit(limit);

  const items = rows.map((r) => ({
    pagePath: r.pagePath,
    elementKey: r.elementKey,
    elementLabel: r.elementLabel,
    componentArea: r.componentArea,
    count: Number(r.count),
  }));
  return { items, totalEvents: items.reduce((s, i) => s + i.count, 0) };
}

export interface HeatmapQuery { pagePath: string; componentArea: string; days?: number }
export async function getHeatmapData(q: HeatmapQuery) {
  const days = clampDays(q.days, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(
    and(
      eq(userEvents.eventType, 'area_click'),
      eq(userEvents.pagePath, q.pagePath),
      eq(userEvents.componentArea, q.componentArea),
      isNotNull(userEvents.clickX),
      isNotNull(userEvents.clickY),
      gte(userEvents.createdAt, start),
    ),
    tenantScope(userEvents),
  );
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
  return { pagePath: q.pagePath, componentArea: q.componentArea, points, total: rows.length };
}

export interface HeatmapPageListQuery { days?: number }
export async function getHeatmapPageList(q: HeatmapPageListQuery) {
  const days = clampDays(q.days, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(
    and(eq(userEvents.eventType, 'area_click'), isNotNull(userEvents.pagePath), isNotNull(userEvents.componentArea), gte(userEvents.createdAt, start)),
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
    if (!r.componentArea) continue;
    if (!pageMap.has(r.pagePath)) pageMap.set(r.pagePath, { pagePath: r.pagePath, pageTitle: r.pageTitle, areas: new Set() });
    pageMap.get(r.pagePath)!.areas.add(r.componentArea);
  }
  return { pages: Array.from(pageMap.values()).map((p) => ({ pagePath: p.pagePath, pageTitle: p.pageTitle, areas: Array.from(p.areas) })) };
}

export interface UserStatsQuery { days?: number; limit?: number }
export async function getUserStats(q: UserStatsQuery) {
  const days = clampDays(q.days, 30);
  const limit = clampLimit(q.limit, 20);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(gte(userEvents.createdAt, start), tenantScope(userEvents));

  const rows = await db
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
    .limit(limit);

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
  return { items, totalUsers: items.length };
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
    })),
    total,
    page,
    pageSize,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 漏斗分析
// ════════════════════════════════════════════════════════════════════════════

export interface FunnelStep { eventType?: UserBehaviorEventType; eventName?: string; pagePath?: string; elementKey?: string; label: string }
export async function getFunnel(input: { days: number; steps: FunnelStep[] }) {
  const days = clampDays(input.days, 30);
  const start = startOfDaysAgo(days);

  const stepUserSets: Set<string>[] = [];
  for (const step of input.steps) {
    const conditions = [gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId)];
    if (step.eventType) conditions.push(eq(userEvents.eventType, step.eventType));
    if (step.eventName) conditions.push(eq(userEvents.eventName, step.eventName));
    if (step.pagePath) conditions.push(eq(userEvents.pagePath, step.pagePath));
    if (step.elementKey) conditions.push(eq(userEvents.elementKey, step.elementKey));
    const where = mergeWhere(and(...conditions), tenantScope(userEvents));
    const rows = await db.selectDistinct({ distinctId: userEvents.distinctId }).from(userEvents).where(where).limit(100_000);
    stepUserSets.push(new Set(rows.map((r) => r.distinctId).filter((d): d is string => d != null)));
  }

  let cumulative = stepUserSets[0] ?? new Set<string>();
  const totalUsers = cumulative.size;
  let prevUsers = totalUsers;
  const steps = input.steps.map((step, i) => {
    if (i > 0) {
      const next = new Set<string>();
      for (const d of cumulative) if (stepUserSets[i].has(d)) next.add(d);
      cumulative = next;
    }
    const users = cumulative.size;
    const result = {
      label: step.label,
      users,
      conversionRate: totalUsers > 0 ? Math.round((users / totalUsers) * 1000) / 10 : 0,
      stepConversionRate: prevUsers > 0 ? Math.round((users / prevUsers) * 1000) / 10 : 0,
      dropoff: Math.max(0, prevUsers - users),
    };
    prevUsers = users;
    return result;
  });

  const finalUsers = steps.at(-1)?.users ?? 0;
  return { steps, totalUsers, overallConversionRate: totalUsers > 0 ? Math.round((finalUsers / totalUsers) * 1000) / 10 : 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// 留存分析
// ════════════════════════════════════════════════════════════════════════════

export async function getRetention(daysRaw: unknown) {
  const days = clampDays(daysRaw, 14, 60);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(and(gte(userEvents.createdAt, start), isNotNull(userEvents.distinctId)), tenantScope(userEvents));

  const rows = await db
    .select({ distinctId: userEvents.distinctId, day: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'YYYY-MM-DD')` })
    .from(userEvents)
    .where(where)
    .groupBy(sql`1, 2`);

  const userDays = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.distinctId) continue;
    if (!userDays.has(r.distinctId)) userDays.set(r.distinctId, new Set());
    userDays.get(r.distinctId)!.add(r.day);
  }

  const firstDayOf = new Map<string, string>();
  for (const [u, set] of userDays) firstDayOf.set(u, Array.from(set).sort()[0]);

  const axis = dateAxis(days);
  const maxPeriods = Math.min(days, 8);
  const periods = Array.from({ length: maxPeriods }, (_, i) => i);

  const cohorts = axis.map((cohortDate, ci) => {
    const cohortUsers = [...firstDayOf.entries()].filter(([, d]) => d === cohortDate).map(([u]) => u);
    const size = cohortUsers.length;
    const values = periods.map((p) => {
      const targetStr = axis[ci + p];
      if (targetStr === undefined) return null;
      if (size === 0) return 0;
      const active = cohortUsers.filter((u) => userDays.get(u)?.has(targetStr)).length;
      return Math.round((active / size) * 1000) / 10;
    });
    return { cohortDate, cohortSize: size, values };
  });

  return { cohorts, periods };
}

// ════════════════════════════════════════════════════════════════════════════
// 路径分析（页面跳转 Sankey）
// ════════════════════════════════════════════════════════════════════════════

export async function getPathAnalysis(input: { days?: number; limit?: number }) {
  const days = clampDays(input.days, 30);
  const limit = clampLimit(input.limit, 12, 30);
  const start = startOfDaysAgo(days);
  const where = mergeWhere(and(eq(userEvents.eventType, 'page_view'), gte(userEvents.createdAt, start)), tenantScope(userEvents));

  // 取每个会话的页面访问序列，构造相邻跳转
  const rows = await db
    .select({ sessionId: userEvents.sessionId, pagePath: userEvents.pagePath, createdAt: userEvents.createdAt })
    .from(userEvents)
    .where(where)
    .orderBy(userEvents.sessionId, userEvents.createdAt)
    .limit(50_000);

  const transitions = new Map<string, number>();
  let lastSession: string | null = null;
  let lastPage: string | null = null;
  for (const r of rows) {
    if (r.sessionId !== lastSession) { lastSession = r.sessionId; lastPage = r.pagePath; continue; }
    if (lastPage && lastPage !== r.pagePath) {
      const key = `${lastPage}\u0001${r.pagePath}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
    lastPage = r.pagePath;
  }

  const sorted = [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const nodeSet = new Set<string>();
  const links = sorted.map(([key, value]) => {
    const [source, target] = key.split('\u0001');
    nodeSet.add(source);
    nodeSet.add(target);
    return { source, target, value };
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
  const start = startOfDaysAgo(days);
  const onlyPv = dimension === 'page';
  const conditions = [gte(userEvents.createdAt, start)];
  if (onlyPv) conditions.push(eq(userEvents.eventType, 'page_view'));
  const where = mergeWhere(and(...conditions), tenantScope(userEvents));

  const rows = await db
    .select({ name: sql<string | null>`${col}`, value: sql<number>`COUNT(*)::int` })
    .from(userEvents)
    .where(where)
    .groupBy(col)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(limit);

  const total = rows.reduce((s, r) => s + Number(r.value), 0);
  const items = rows.map((r) => ({
    name: r.name ?? (dimension === 'referrer' || dimension === 'source' ? '直接访问' : '未知'),
    value: Number(r.value),
    percent: total > 0 ? Math.round((Number(r.value) / total) * 1000) / 10 : 0,
  }));
  return { dimension, total, items };
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

  const { perfRating } = await import('../lib/analytics-helpers');
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
    })
    .from(userEvents)
    .where(where)
    .orderBy(desc(userEvents.createdAt))
    .limit(max);
  return rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) }));
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
