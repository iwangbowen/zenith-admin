import { and, gte, lt, sql, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { buildWhere } from '../../lib/where-helpers';
import { db } from '../../db';
import { userEvents, analyticsSessions, analyticsDailyRollup } from '../../db/schema';
import { clampDays } from '../../lib/analytics-helpers';
import { APP_TIME_ZONE, formatDate, parseDateRangeStart } from '../../lib/datetime';
import { config } from '../../config';
import { currentUser } from '../../lib/context';
import { isPlatformAdmin, getEffectiveTenantId } from '../../lib/tenant';

interface RollupRow { tenantId: number; statDate: string; metric: string; dimType: string; dimValue: string; value: number }

const DAY_MS = 86_400_000;

// 参与每日预聚合的低基数维度（referrer/utmSource 基数不可控，留在 raw 查询路径）
const DIM_SOURCES = [
  { dimType: 'browser', col: userEvents.browser, metric: 'events', onlyPv: false },
  { dimType: 'os', col: userEvents.os, metric: 'events', onlyPv: false },
  { dimType: 'device', col: userEvents.deviceType, metric: 'events', onlyPv: false },
  { dimType: 'region', col: userEvents.region, metric: 'events', onlyPv: false },
  { dimType: 'page', col: userEvents.pagePath, metric: 'pv', onlyPv: true },
] as const;

/** getDimensionBreakdown 可走预聚合的维度集合。 */
export const ROLLUP_DIM_TYPES: ReadonlySet<string> = new Set(DIM_SOURCES.map((d) => d.dimType));

function appTodayStart(): Date {
  return parseDateRangeStart(formatDate(new Date())) ?? new Date();
}

/**
 * 聚合断档自愈：启动时检测 rollup 最新 stat_date 距昨日的缺口，一次性补齐。
 * dev / 停机跨过每日 01:00 的定时重建会产生永久缺口，此钩子保证重启即恢复。
 * 缺口有界（最多回补 30 天），rebuildRollup 幂等（delete + insert 全量重算窗口）。
 */
export async function catchUpRollupGaps(): Promise<number> {
  const [latest] = await db
    .select({ maxDate: sql<string | null>`MAX(${analyticsDailyRollup.statDate})::text` })
    .from(analyticsDailyRollup);
  const todayStart = appTodayStart();
  const yesterday = formatDate(new Date(todayStart.getTime() - DAY_MS));
  const maxDate = latest?.maxDate ?? null;
  if (maxDate && maxDate >= yesterday) return 0;
  const gapDays = maxDate
    ? Math.min(Math.ceil((todayStart.getTime() - (parseDateRangeStart(maxDate)?.getTime() ?? todayStart.getTime())) / DAY_MS), 30)
    : 7;
  if (gapDays <= 0) return 0;
  return rebuildRollup(gapDays);
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

/** 重建最近 days 个完整自然日的每日聚合（overall 总量 + 低基数维度分布）。 */
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
  const overall = (r: { tenantId: number; statDate: string }, metric: string, value: number) =>
    upserts.push({ tenantId: Number(r.tenantId), statDate: r.statDate, metric, dimType: 'overall', dimValue: '', value });

  for (const r of eventRows) {
    overall(r, 'pv', Number(r.pv));
    overall(r, 'uv', Number(r.uv));
    overall(r, 'events', Number(r.events));
    overall(r, 'sessions', Number(r.sessions));
  }
  for (const r of sessionRows) {
    overall(r, 'bounce_sessions', Number(r.bounce));
    overall(r, 'total_dwell_ms', Number(r.dwell));
  }

  // ── 维度聚合（NULL 维度值以 '' 哨兵存储，查询侧映射回「未知」）──────────────
  for (const dim of DIM_SOURCES) {
    const where = buildWhere(
      gte(userEvents.createdAt, start),
      lt(userEvents.createdAt, todayStart),
      dim.onlyPv ? eq(userEvents.eventType, 'page_view') : undefined,
    );
    const rows = await db
      .select({
        tenantId: sql<number>`COALESCE(${userEvents.tenantId}, 0)`,
        statDate: sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${userEvents.createdAt}), 'YYYY-MM-DD')`,
        dimValue: sql<string>`COALESCE(${dim.col}::text, '')`,
        value: sql<number>`COUNT(*)::int`,
      })
      .from(userEvents)
      .where(where)
      .groupBy(sql`1, 2, 3`);
    for (const r of rows) {
      upserts.push({ tenantId: Number(r.tenantId), statDate: r.statDate, metric: dim.metric, dimType: dim.dimType, dimValue: r.dimValue.slice(0, 256), value: Number(r.value) });
    }
  }

  // 批量 UPSERT（分片规避参数上限；同批内 (tenant,date,metric,dim,dimValue) 天然唯一）
  const CHUNK = 500;
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const chunk = upserts.slice(i, i + CHUNK);
    await db
      .insert(analyticsDailyRollup)
      .values(chunk)
      .onConflictDoUpdate({
        target: [analyticsDailyRollup.tenantId, analyticsDailyRollup.statDate, analyticsDailyRollup.metric, analyticsDailyRollup.dimType, analyticsDailyRollup.dimValue],
        set: { value: sql`excluded.value` },
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

/**
 * 清理不再被任何错误事件引用的错误分组。
 * 由 `error_events` 保留策略在删除后触发，避免分组表随事件裁剪产生孤儿行。
 */
export async function purgeOrphanErrorGroups(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM error_groups
    WHERE NOT EXISTS (SELECT 1 FROM error_events ee WHERE ee.group_id = error_groups.id)
  `);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
