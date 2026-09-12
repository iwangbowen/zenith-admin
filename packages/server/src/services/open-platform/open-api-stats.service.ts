import { gte, lte, eq, desc, sql, count, type SQL } from 'drizzle-orm';
import dayjs from 'dayjs';
import type { QueryOutputOf } from '@zenith/shared/core';
import { openApiStatsContract } from '@zenith/shared/open-platform';
import { db } from '../../db';
import { openApiCallLogs, openApiCallStatsDaily } from '../../db/schema';
import { buildListResult } from '../../lib/list-query';
import { APP_TIME_ZONE, formatDate, formatDateTime, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { getPolicyRetentionDays } from '../../lib/retention';
import { HTTPException } from 'hono/http-exception';

const APP_TIME_ZONE_SQL = sql.raw(`'${APP_TIME_ZONE.replaceAll("'", "''")}'`);

type OpenApiStatsRangeInput = QueryOutputOf<typeof openApiStatsContract.overview>;

/** 原始调用日志范围：时间窗 + 应用 + 环境 */
function rangeWhere(opts: OpenApiStatsRangeInput): SQL | undefined {
  const start = parseDateRangeStart(opts.startTime);
  const end = parseDateRangeEnd(opts.endTime);
  return buildWhere(
    start ? gte(openApiCallLogs.createdAt, start) : undefined,
    end ? lte(openApiCallLogs.createdAt, end) : undefined,
    opts.clientId ? eq(openApiCallLogs.clientId, opts.clientId) : undefined,
    opts.environment ? eq(openApiCallLogs.environment, opts.environment) : undefined,
  );
}

/** 日聚合表范围：时间窗 + 应用 + 环境，且只取已聚合到水位线的日期（无水位线时恒 false） */
function dailyRangeWhere(opts: OpenApiStatsRangeInput, watermark: string | null): SQL | undefined {
  const start = parseDateRangeStart(opts.startTime);
  const end = parseDateRangeEnd(opts.endTime);
  return buildWhere(
    start ? gte(openApiCallStatsDaily.statDate, formatDate(start)) : undefined,
    end ? lte(openApiCallStatsDaily.statDate, formatDate(end)) : undefined,
    opts.clientId ? eq(openApiCallStatsDaily.clientId, opts.clientId) : undefined,
    opts.environment ? eq(openApiCallStatsDaily.environment, opts.environment) : undefined,
    watermark ? lte(openApiCallStatsDaily.statDate, watermark) : sql`false`,
  );
}

function todayStart(): Date {
  return dayjs().tz(APP_TIME_ZONE).startOf('day').toDate();
}

async function aggregationWatermark(): Promise<string | null> {
  const [row] = await db.select({
    value: sql<string | null>`max(${openApiCallStatsDaily.statDate})`,
  }).from(openApiCallStatsDaily);
  return row?.value ?? null;
}

/** 原始日志中尚未被日聚合覆盖的尾段：范围条件 + 水位线次日起 */
function rawTailWhere(opts: OpenApiStatsRangeInput, watermark: string | null): SQL | undefined {
  const tailStart = watermark
    ? dayjs.tz(`${watermark} 00:00:00`, APP_TIME_ZONE).add(1, 'day').toDate()
    : undefined;
  return buildWhere(rangeWhere(opts), tailStart ? gte(openApiCallLogs.createdAt, tailStart) : undefined);
}

function assertAggregateBoundaryCompatible(opts: OpenApiStatsRangeInput, watermark: string | null): void {
  if (!watermark) return;
  const { startTime, endTime } = opts;
  const startDate = startTime?.slice(0, 10);
  const endDate = endTime?.slice(0, 10);
  if (startTime && startDate && startDate <= watermark && startTime.length > 10 && !startTime.endsWith('00:00:00')) {
    throw new HTTPException(400, { message: '历史聚合统计的开始时间必须为当日 00:00:00' });
  }
  if (endTime && endDate && endDate <= watermark && endTime.length > 10 && !endTime.endsWith('23:59:59')) {
    throw new HTTPException(400, { message: '历史聚合统计的结束时间必须为当日 23:59:59' });
  }
}

const successFilter = sql<number>`count(*) filter (where ${openApiCallLogs.success} = true)`;
const p95Duration = sql<number>`coalesce(percentile_cont(0.95) within group (order by ${openApiCallLogs.durationMs}), 0)`;
const p99Duration = sql<number>`coalesce(percentile_cont(0.99) within group (order by ${openApiCallLogs.durationMs}), 0)`;

export async function getOpenApiStatsOverview(opts: OpenApiStatsRangeInput) {
  const watermark = await aggregationWatermark();
  assertAggregateBoundaryCompatible(opts, watermark);
  const rawWhere = rawTailWhere(opts, watermark);
  const dailyWhere = dailyRangeWhere(opts, watermark);
  const percentileWhere = rangeWhere(opts);
  const todayWhere = buildWhere(
    gte(openApiCallLogs.createdAt, todayStart()),
    opts.clientId ? eq(openApiCallLogs.clientId, opts.clientId) : undefined,
    opts.environment ? eq(openApiCallLogs.environment, opts.environment) : undefined,
  );
  const [rawAgg, dailyAgg, percentileAgg, rawApps, dailyApps, todayCalls] = await Promise.all([
    db
      .select({
        total: count(),
        success: successFilter,
        durationSum: sql<number>`coalesce(sum(${openApiCallLogs.durationMs}), 0)`,
      })
      .from(openApiCallLogs)
      .where(rawWhere),
    db.select({
      total: sql<number>`coalesce(sum(${openApiCallStatsDaily.totalCalls}), 0)`,
      success: sql<number>`coalesce(sum(${openApiCallStatsDaily.successCalls}), 0)`,
      durationSum: sql<number>`coalesce(sum(${openApiCallStatsDaily.durationSumMs}), 0)`,
    }).from(openApiCallStatsDaily).where(dailyWhere),
    db.select({
        p95: p95Duration,
        p99: p99Duration,
    }).from(openApiCallLogs).where(percentileWhere),
    db.selectDistinct({ clientId: openApiCallLogs.clientId })
      .from(openApiCallLogs)
      .where(rawWhere),
    db.selectDistinct({ clientId: openApiCallStatsDaily.clientId })
      .from(openApiCallStatsDaily)
      .where(dailyWhere),
    db.$count(openApiCallLogs, todayWhere),
  ]);

  const total = Number(rawAgg[0]?.total ?? 0) + Number(dailyAgg[0]?.total ?? 0);
  const success = Number(rawAgg[0]?.success ?? 0) + Number(dailyAgg[0]?.success ?? 0);
  const durationSum = Number(rawAgg[0]?.durationSum ?? 0) + Number(dailyAgg[0]?.durationSum ?? 0);
  const failed = total - success;
  const logRetentionDays = await getPolicyRetentionDays('open_api_call_logs');
  const percentileCutoff = dayjs().tz(APP_TIME_ZONE)
    .subtract(logRetentionDays, 'day')
    .startOf('day')
    .toDate();
  const requestedStart = parseDateRangeStart(opts.startTime);
  return {
    totalCalls: total,
    successCalls: success,
    failedCalls: failed,
    successRate: total > 0 ? Math.round((success / total) * 10000) / 100 : 0,
    avgDurationMs: total > 0 ? Math.round(durationSum / total) : 0,
    p95DurationMs: Math.round(Number(percentileAgg[0]?.p95 ?? 0)),
    p99DurationMs: Math.round(Number(percentileAgg[0]?.p99 ?? 0)),
    percentilesPartial: !requestedStart || requestedStart < percentileCutoff,
    percentileRetentionDays: logRetentionDays,
    activeApps: new Set([...rawApps, ...dailyApps].map((row) => row.clientId)).size,
    todayCalls: Number(todayCalls),
  };
}

export async function getOpenApiStatsTrend(opts: QueryOutputOf<typeof openApiStatsContract.trend>) {
  const where = rangeWhere(opts);
  if (opts.granularity !== 'hour') {
    const watermark = await aggregationWatermark();
    assertAggregateBoundaryCompatible(opts, watermark);
    const dailyWhere = dailyRangeWhere(opts, watermark);
    const rawWhere = rawTailWhere(opts, watermark);
    const [dailyRows, rawRows] = await Promise.all([
      db.select({
        time: openApiCallStatsDaily.statDate,
        total: sql<number>`sum(${openApiCallStatsDaily.totalCalls})`,
        success: sql<number>`sum(${openApiCallStatsDaily.successCalls})`,
        failed: sql<number>`sum(${openApiCallStatsDaily.failedCalls})`,
      }).from(openApiCallStatsDaily)
        .where(dailyWhere)
        .groupBy(openApiCallStatsDaily.statDate)
        .orderBy(openApiCallStatsDaily.statDate),
      db.select({
        time: sql<string>`to_char(${openApiCallLogs.createdAt} at time zone 'UTC' at time zone ${APP_TIME_ZONE_SQL}, 'YYYY-MM-DD')`,
        total: count(),
        success: successFilter,
      }).from(openApiCallLogs)
        .where(rawWhere)
        .groupBy(sql`to_char(${openApiCallLogs.createdAt} at time zone 'UTC' at time zone ${APP_TIME_ZONE_SQL}, 'YYYY-MM-DD')`),
    ]);
    return [...dailyRows.map((row) => ({
      time: row.time,
      total: Number(row.total),
      success: Number(row.success),
      failed: Number(row.failed),
    })), ...rawRows.map((row) => {
      const total = Number(row.total);
      const success = Number(row.success);
      return { time: row.time, total, success, failed: total - success };
    })].sort((a, b) => a.time.localeCompare(b.time));
  }
  const requestedStart = parseDateRangeStart(opts.startTime);
  const logRetentionDays = await getPolicyRetentionDays('open_api_call_logs');
  const hourlyCutoff = dayjs().tz(APP_TIME_ZONE)
    .subtract(logRetentionDays, 'day')
    .startOf('day')
    .toDate();
  if (requestedStart && requestedStart < hourlyCutoff) {
    throw new HTTPException(400, {
      message: `按小时统计仅支持最近 ${logRetentionDays} 天`,
    });
  }
  const bucket =
    sql<string>`to_char(${openApiCallLogs.createdAt} at time zone 'UTC' at time zone ${APP_TIME_ZONE_SQL}, 'YYYY-MM-DD HH24:00:00')`;

  const rows = await db
    .select({ time: bucket, total: count(), success: successFilter })
    .from(openApiCallLogs)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => {
    const total = Number(r.total);
    const success = Number(r.success);
    return { time: r.time, total, success, failed: total - success };
  });
}

async function groupBy(opts: QueryOutputOf<typeof openApiStatsContract.byApp>, withName: boolean) {
  const limit = opts.limit ?? 10;
  const rawColumn = withName ? openApiCallLogs.clientId : openApiCallLogs.path;
  const dailyColumn = withName ? openApiCallStatsDaily.clientId : openApiCallStatsDaily.path;
  const rawLabel = withName
    ? sql<string>`coalesce(max(${openApiCallLogs.appName}), ${rawColumn})`
    : sql<string>`${rawColumn}`;
  const dailyLabel = withName
    ? sql<string>`coalesce(max(${openApiCallStatsDaily.appName}), ${dailyColumn})`
    : sql<string>`${dailyColumn}`;
  const watermark = await aggregationWatermark();
  assertAggregateBoundaryCompatible(opts, watermark);
  const dailyWhere = dailyRangeWhere(opts, watermark);
  const rawWhere = rawTailWhere(opts, watermark);
  const [rawRows, dailyRows] = await Promise.all([
    db.select({
      key: rawColumn,
      label: rawLabel,
      total: count(),
      success: successFilter,
      durationSum: sql<number>`coalesce(sum(${openApiCallLogs.durationMs}), 0)`,
    }).from(openApiCallLogs)
      .where(rawWhere)
      .groupBy(rawColumn),
    db.select({
      key: dailyColumn,
      label: dailyLabel,
      total: sql<number>`sum(${openApiCallStatsDaily.totalCalls})`,
      success: sql<number>`sum(${openApiCallStatsDaily.successCalls})`,
      durationSum: sql<number>`sum(${openApiCallStatsDaily.durationSumMs})`,
    }).from(openApiCallStatsDaily)
      .where(dailyWhere)
      .groupBy(dailyColumn),
  ]);
  const merged = new Map<string, {
    key: string;
    label: string;
    total: number;
    success: number;
    durationSum: number;
  }>();
  for (const row of [...dailyRows, ...rawRows]) {
    const current = merged.get(row.key) ?? {
      key: row.key,
      label: row.label,
      total: 0,
      success: 0,
      durationSum: 0,
    };
    current.label = row.label || current.label;
    current.total += Number(row.total);
    current.success += Number(row.success);
    current.durationSum += Number(row.durationSum);
    merged.set(row.key, current);
  }
  return [...merged.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((row) => ({
      key: row.key,
      label: row.label,
      total: row.total,
      success: row.success,
      failed: row.total - row.success,
      avgDurationMs: row.total > 0 ? Math.round(row.durationSum / row.total) : 0,
    }));
}

export function getOpenApiStatsByApp(opts: QueryOutputOf<typeof openApiStatsContract.byApp>) {
  return groupBy(opts, true);
}

export function getOpenApiStatsByEndpoint(opts: QueryOutputOf<typeof openApiStatsContract.byEndpoint>) {
  return groupBy(opts, false);
}

type OpenApiCallLogQuery = QueryOutputOf<typeof openApiStatsContract.logs>;

export function buildOpenApiCallLogWhere(opts: Omit<OpenApiCallLogQuery, 'page' | 'pageSize'>): SQL | undefined {
  return buildWhere(
    rangeWhere(opts),
    typeof opts.success === 'boolean' ? eq(openApiCallLogs.success, opts.success) : undefined,
    opts.method ? eq(openApiCallLogs.method, opts.method.toUpperCase()) : undefined,
    opts.statusCode === undefined ? undefined : eq(openApiCallLogs.statusCode, opts.statusCode),
    keywordCondition(opts.keyword, [openApiCallLogs.path, openApiCallLogs.appName], 'ilike'),
  );
}

export async function listOpenApiCallLogs(opts: OpenApiCallLogQuery) {
  const { page, pageSize } = opts;
  const where = buildOpenApiCallLogWhere(opts);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(openApiCallLogs, where),
    rows: () => db
      .select()
      .from(openApiCallLogs)
      .where(where)
      .orderBy(desc(openApiCallLogs.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (r) => ({
      id: r.id,
      clientId: r.clientId,
      appName: r.appName ?? null,
      method: r.method,
      path: r.path,
      statusCode: r.statusCode,
      success: r.success,
      durationMs: r.durationMs,
      ip: r.ip ?? null,
      userAgent: r.userAgent ?? null,
      scope: r.scope ?? null,
      authChannel: (r.authChannel ?? null) as 'bearer' | 'signature' | null,
      userId: r.userId ?? null,
      errorMessage: r.errorMessage ?? null,
      requestId: r.requestId ?? null,
      environment: r.environment as 'production' | 'sandbox',
      createdAt: formatDateTime(r.createdAt),
    }),
  });
}
