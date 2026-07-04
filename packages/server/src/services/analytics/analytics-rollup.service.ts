import { and, gte, lt, sql, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../../db';
import { userEvents, analyticsSessions, analyticsDailyRollup, analyticsSettings, errorEvents, errorGroups } from '../../db/schema';
import { clampDays } from '../../lib/analytics-helpers';
import { APP_TIME_ZONE, formatDate, parseDateRangeStart } from '../../lib/datetime';
import { config } from '../../config';
import { currentUser } from '../../lib/context';
import { isPlatformAdmin, getEffectiveTenantId } from '../../lib/tenant';

interface RollupRow { tenantId: number; statDate: string; metric: string; value: number }

const DAY_MS = 86_400_000;

function appTodayStart(): Date {
  return parseDateRangeStart(formatDate(new Date())) ?? new Date();
}

/**
 * rollup 表租户过滤：语义对齐 `tenantScope`，区别是 rollup 的 tenantId 非空，
 * NULL 租户以 0 哨兵存储（见表定义注释）。
 */
export function rollupTenantScope(): SQL | undefined {
  if (!config.multiTenantMode) return undefined;
  const user = currentUser();
  const effective = getEffectiveTenantId(user);
  if (isPlatformAdmin(user) && effective === null) return undefined;
  return eq(analyticsDailyRollup.tenantId, effective ?? 0);
}

/** 重建最近 days 个完整自然日的每日聚合（overall 维度）。 */
export async function rebuildRollup(daysRaw: unknown): Promise<number> {
  const days = clampDays(daysRaw, 30, 730);
  const todayStart = appTodayStart();
  const start = new Date(todayStart.getTime() - days * DAY_MS);

  const eventRows = await db
    .select({
      tenantId: sql<number>`COALESCE(${userEvents.tenantId}, 0)`,
      statDate: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'YYYY-MM-DD')`,
      pv: sql<number>`COUNT(*) FILTER (WHERE ${userEvents.eventType} = 'page_view')::int`,
      uv: sql<number>`COUNT(DISTINCT ${userEvents.distinctId})::int`,
      events: sql<number>`COUNT(*)::int`,
      sessions: sql<number>`COUNT(DISTINCT ${userEvents.sessionId})::int`,
    })
    .from(userEvents)
    .where(and(gte(userEvents.createdAt, start), lt(userEvents.createdAt, todayStart)))
    .groupBy(sql`1, 2`);

  const sessionRows = await db
    .select({
      tenantId: sql<number>`COALESCE(${analyticsSessions.tenantId}, 0)`,
      statDate: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${analyticsSessions.startedAt}), 'YYYY-MM-DD')`,
      bounce: sql<number>`COUNT(*) FILTER (WHERE ${analyticsSessions.isBounce})::int`,
      dwell: sql<number>`COALESCE(SUM(${analyticsSessions.durationMs}), 0)::bigint`,
    })
    .from(analyticsSessions)
    .where(and(gte(analyticsSessions.startedAt, start), lt(analyticsSessions.startedAt, todayStart)))
    .groupBy(sql`1, 2`);

  const upserts: RollupRow[] = [];
  for (const r of eventRows) {
    upserts.push(
      { tenantId: Number(r.tenantId), statDate: r.statDate, metric: 'pv', value: Number(r.pv) },
      { tenantId: Number(r.tenantId), statDate: r.statDate, metric: 'uv', value: Number(r.uv) },
      { tenantId: Number(r.tenantId), statDate: r.statDate, metric: 'events', value: Number(r.events) },
      { tenantId: Number(r.tenantId), statDate: r.statDate, metric: 'sessions', value: Number(r.sessions) },
    );
  }
  for (const r of sessionRows) {
    upserts.push(
      { tenantId: Number(r.tenantId), statDate: r.statDate, metric: 'bounce_sessions', value: Number(r.bounce) },
      { tenantId: Number(r.tenantId), statDate: r.statDate, metric: 'total_dwell_ms', value: Number(r.dwell) },
    );
  }

  for (const u of upserts) {
    await db
      .insert(analyticsDailyRollup)
      .values({ tenantId: u.tenantId, statDate: u.statDate, metric: u.metric, dimType: 'overall', dimValue: '', value: u.value })
      .onConflictDoUpdate({
        target: [analyticsDailyRollup.tenantId, analyticsDailyRollup.statDate, analyticsDailyRollup.metric, analyticsDailyRollup.dimType, analyticsDailyRollup.dimValue],
        set: { value: u.value },
      });
  }

  return upserts.length;
}

export interface RollupSummaryItem {
  statDate: string;
  pv: number;
  uv: number;
  sessions: number;
  events: number;
  bounceSessions: number;
  totalDwellMs: number;
}

/** 读取每日聚合（供数据管理「数据聚合」面板展示）。 */
export async function getRollupSummary(daysRaw: unknown): Promise<RollupSummaryItem[]> {
  const days = clampDays(daysRaw, 30, 730);
  const todayStart = appTodayStart();
  const start = new Date(todayStart.getTime() - days * DAY_MS);
  const startStr = formatDate(start);

  const rows = await db
    .select({ statDate: analyticsDailyRollup.statDate, metric: analyticsDailyRollup.metric, value: analyticsDailyRollup.value })
    .from(analyticsDailyRollup)
    .where(and(eq(analyticsDailyRollup.dimType, 'overall'), gte(analyticsDailyRollup.statDate, startStr)));

  const byDate = new Map<string, RollupSummaryItem>();
  for (const r of rows) {
    const item = byDate.get(r.statDate) ?? { statDate: r.statDate, pv: 0, uv: 0, sessions: 0, events: 0, bounceSessions: 0, totalDwellMs: 0 };
    if (r.metric === 'pv') item.pv = Number(r.value);
    else if (r.metric === 'uv') item.uv = Number(r.value);
    else if (r.metric === 'sessions') item.sessions = Number(r.value);
    else if (r.metric === 'events') item.events = Number(r.value);
    else if (r.metric === 'bounce_sessions') item.bounceSessions = Number(r.value);
    else if (r.metric === 'total_dwell_ms') item.totalDwellMs = Number(r.value);
    byDate.set(r.statDate, item);
  }
  return [...byDate.values()].sort((a, b) => b.statDate.localeCompare(a.statDate));
}

/** 读取全局保留策略（取 null 租户或首行，回退默认值）。 */
async function getRetentionPolicy(): Promise<{ eventDays: number; errorDays: number }> {
  const [row] = await db.select({ retentionDays: analyticsSettings.retentionDays, errorRetentionDays: analyticsSettings.errorRetentionDays }).from(analyticsSettings).orderBy(analyticsSettings.id).limit(1);
  return { eventDays: row?.retentionDays ?? 180, errorDays: row?.errorRetentionDays ?? 90 };
}

/** 按保留策略清理过期埋点/会话/错误数据（cron）。 */
export async function runAnalyticsRetention(): Promise<{ events: number; sessions: number; errors: number }> {
  const { eventDays, errorDays } = await getRetentionPolicy();
  const evRes = await db.delete(userEvents).where(sql`${userEvents.createdAt} < NOW() - (${eventDays} * INTERVAL '1 day')`);
  const sessRes = await db.delete(analyticsSessions).where(sql`${analyticsSessions.startedAt} < NOW() - (${eventDays} * INTERVAL '1 day')`);
  const errEvRes = await db.delete(errorEvents).where(sql`${errorEvents.createdAt} < NOW() - (${errorDays} * INTERVAL '1 day')`);
  // 删除已无任何事件的空分组
  await db.delete(errorGroups).where(sql`${errorGroups.lastSeenAt} < NOW() - (${errorDays} * INTERVAL '1 day') AND NOT EXISTS (SELECT 1 FROM error_events ee WHERE ee.group_id = ${errorGroups.id})`);
  const rc = (r: unknown) => (r as { rowCount?: number }).rowCount ?? 0;
  return { events: rc(evRes), sessions: rc(sessRes), errors: rc(errEvRes) };
}
