import { and, gte, lte, eq, or, ilike, desc, sql, count, type SQL } from 'drizzle-orm';
import dayjs from 'dayjs';
import { db } from '../../db';
import { openApiCallLogs, openApiCallStatsDaily } from '../../db/schema';
import { APP_TIME_ZONE, formatDate, formatDateTime, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { config } from '../../config';
import { HTTPException } from 'hono/http-exception';

const APP_TIME_ZONE_SQL = sql.raw(`'${APP_TIME_ZONE.replaceAll("'", "''")}'`);

export interface OpenApiStatsRangeInput {
  startTime?: string;
  endTime?: string;
  clientId?: string;
  environment?: 'production' | 'sandbox';
}

function rangeConditions(opts: OpenApiStatsRangeInput): SQL[] {
  const conds: SQL[] = [];
  const start = parseDateRangeStart(opts.startTime);
  const end = parseDateRangeEnd(opts.endTime);
  if (start) conds.push(gte(openApiCallLogs.createdAt, start));
  if (end) conds.push(lte(openApiCallLogs.createdAt, end));
  if (opts.clientId) conds.push(eq(openApiCallLogs.clientId, opts.clientId));
  if (opts.environment) conds.push(eq(openApiCallLogs.environment, opts.environment));
  return conds;
}

function dailyRangeConditions(opts: OpenApiStatsRangeInput): SQL[] {
  const conds: SQL[] = [];
  const start = parseDateRangeStart(opts.startTime);
  const end = parseDateRangeEnd(opts.endTime);
  if (start) conds.push(gte(openApiCallStatsDaily.statDate, formatDate(start)));
  if (end) conds.push(lte(openApiCallStatsDaily.statDate, formatDate(end)));
  if (opts.clientId) conds.push(eq(openApiCallStatsDaily.clientId, opts.clientId));
  if (opts.environment) conds.push(eq(openApiCallStatsDaily.environment, opts.environment));
  return conds;
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

function rawTailConditions(opts: OpenApiStatsRangeInput, watermark: string | null): SQL[] {
  const conditions = rangeConditions(opts);
  if (watermark) {
    const tailStart = dayjs.tz(`${watermark} 00:00:00`, APP_TIME_ZONE)
      .add(1, 'day')
      .toDate();
    conditions.push(gte(openApiCallLogs.createdAt, tailStart));
  }
  return conditions;
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
  const rawConditions = rawTailConditions(opts, watermark);
  const rawWhere = rawConditions.length ? and(...rawConditions) : undefined;
  const dailyConditions = dailyRangeConditions(opts);
  dailyConditions.push(watermark ? lte(openApiCallStatsDaily.statDate, watermark) : sql`false`);
  const dailyWhere = and(...dailyConditions);
  const percentileWhere = rangeConditions(opts);
  const todayConditions: SQL[] = [gte(openApiCallLogs.createdAt, todayStart())];
  if (opts.clientId) todayConditions.push(eq(openApiCallLogs.clientId, opts.clientId));
  if (opts.environment) todayConditions.push(eq(openApiCallLogs.environment, opts.environment));
  const todayWhere = and(...todayConditions);
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
    }).from(openApiCallLogs).where(percentileWhere.length ? and(...percentileWhere) : undefined),
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
  const percentileCutoff = dayjs().tz(APP_TIME_ZONE)
    .subtract(config.openPlatform.apiLogRetentionDays, 'day')
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
    percentileRetentionDays: config.openPlatform.apiLogRetentionDays,
    activeApps: new Set([...rawApps, ...dailyApps].map((row) => row.clientId)).size,
    todayCalls: Number(todayCalls),
  };
}

export async function getOpenApiStatsTrend(opts: OpenApiStatsRangeInput & { granularity?: 'hour' | 'day' }) {
  const conds = rangeConditions(opts);
  const where = conds.length ? and(...conds) : undefined;
  if (opts.granularity !== 'hour') {
    const watermark = await aggregationWatermark();
    assertAggregateBoundaryCompatible(opts, watermark);
    const dailyConditions = dailyRangeConditions(opts);
    dailyConditions.push(watermark ? lte(openApiCallStatsDaily.statDate, watermark) : sql`false`);
    const rawConditions = rawTailConditions(opts, watermark);
    const [dailyRows, rawRows] = await Promise.all([
      db.select({
        time: openApiCallStatsDaily.statDate,
        total: sql<number>`sum(${openApiCallStatsDaily.totalCalls})`,
        success: sql<number>`sum(${openApiCallStatsDaily.successCalls})`,
        failed: sql<number>`sum(${openApiCallStatsDaily.failedCalls})`,
      }).from(openApiCallStatsDaily)
        .where(and(...dailyConditions))
        .groupBy(openApiCallStatsDaily.statDate)
        .orderBy(openApiCallStatsDaily.statDate),
      db.select({
        time: sql<string>`to_char(${openApiCallLogs.createdAt} at time zone 'UTC' at time zone ${APP_TIME_ZONE_SQL}, 'YYYY-MM-DD')`,
        total: count(),
        success: successFilter,
      }).from(openApiCallLogs)
        .where(rawConditions.length ? and(...rawConditions) : undefined)
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
  const hourlyCutoff = dayjs().tz(APP_TIME_ZONE)
    .subtract(config.openPlatform.apiLogRetentionDays, 'day')
    .startOf('day')
    .toDate();
  if (requestedStart && requestedStart < hourlyCutoff) {
    throw new HTTPException(400, {
      message: `按小时统计仅支持最近 ${config.openPlatform.apiLogRetentionDays} 天`,
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

async function groupBy(opts: OpenApiStatsRangeInput & { limit?: number }, withName: boolean) {
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
  const dailyConditions = dailyRangeConditions(opts);
  dailyConditions.push(watermark ? lte(openApiCallStatsDaily.statDate, watermark) : sql`false`);
  const rawConditions = rawTailConditions(opts, watermark);
  const [rawRows, dailyRows] = await Promise.all([
    db.select({
      key: rawColumn,
      label: rawLabel,
      total: count(),
      success: successFilter,
      durationSum: sql<number>`coalesce(sum(${openApiCallLogs.durationMs}), 0)`,
    }).from(openApiCallLogs)
      .where(rawConditions.length ? and(...rawConditions) : undefined)
      .groupBy(rawColumn),
    db.select({
      key: dailyColumn,
      label: dailyLabel,
      total: sql<number>`sum(${openApiCallStatsDaily.totalCalls})`,
      success: sql<number>`sum(${openApiCallStatsDaily.successCalls})`,
      durationSum: sql<number>`sum(${openApiCallStatsDaily.durationSumMs})`,
    }).from(openApiCallStatsDaily)
      .where(and(...dailyConditions))
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

export function getOpenApiStatsByApp(opts: OpenApiStatsRangeInput & { limit?: number }) {
  return groupBy(opts, true);
}

export function getOpenApiStatsByEndpoint(opts: OpenApiStatsRangeInput & { limit?: number }) {
  return groupBy(opts, false);
}

export interface OpenApiCallLogQuery extends OpenApiStatsRangeInput {
  page: number;
  pageSize: number;
  success?: boolean;
  method?: string;
  statusCode?: number;
  keyword?: string;
}

export function buildOpenApiCallLogWhere(opts: Omit<OpenApiCallLogQuery, 'page' | 'pageSize'>): SQL | undefined {
  const conds = rangeConditions(opts);
  if (typeof opts.success === 'boolean') conds.push(eq(openApiCallLogs.success, opts.success));
  if (opts.method) conds.push(eq(openApiCallLogs.method, opts.method.toUpperCase()));
  if (opts.statusCode !== undefined) conds.push(eq(openApiCallLogs.statusCode, opts.statusCode));
  if (opts.keyword) {
    const kw = `%${escapeLike(opts.keyword)}%`;
    conds.push(or(ilike(openApiCallLogs.path, kw), ilike(openApiCallLogs.appName, kw)) as SQL);
  }
  return conds.length ? and(...conds) : undefined;
}

export async function listOpenApiCallLogs(opts: OpenApiCallLogQuery) {
  const { page, pageSize } = opts;
  const where = buildOpenApiCallLogWhere(opts);

  const [list, total] = await Promise.all([
    db
      .select()
      .from(openApiCallLogs)
      .where(where)
      .orderBy(desc(openApiCallLogs.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(openApiCallLogs, where),
  ]);

  return {
    list: list.map((r) => ({
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
      errorMessage: r.errorMessage ?? null,
      requestId: r.requestId ?? null,
      environment: r.environment as 'production' | 'sandbox',
      createdAt: formatDateTime(r.createdAt),
    })),
    total,
    page,
    pageSize,
  };
}
