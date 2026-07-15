import { and, gte, lte, eq, or, ilike, desc, sql, count, type SQL } from 'drizzle-orm';
import dayjs from 'dayjs';
import { db } from '../../db';
import { openApiCallLogs } from '../../db/schema';
import { formatDateTime, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';

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

const successFilter = sql<number>`count(*) filter (where ${openApiCallLogs.success} = true)`;
const avgDuration = sql<number>`coalesce(avg(${openApiCallLogs.durationMs}), 0)`;
const p95Duration = sql<number>`coalesce(percentile_cont(0.95) within group (order by ${openApiCallLogs.durationMs}), 0)`;
const p99Duration = sql<number>`coalesce(percentile_cont(0.99) within group (order by ${openApiCallLogs.durationMs}), 0)`;

export async function getOpenApiStatsOverview(opts: OpenApiStatsRangeInput) {
  const conds = rangeConditions(opts);
  const where = conds.length ? and(...conds) : undefined;

  const todayStart = dayjs().startOf('day').toDate();

  const todayConditions: SQL[] = [gte(openApiCallLogs.createdAt, todayStart)];
  if (opts.clientId) todayConditions.push(eq(openApiCallLogs.clientId, opts.clientId));
  if (opts.environment) todayConditions.push(eq(openApiCallLogs.environment, opts.environment));
  const todayWhere = and(...todayConditions);
  const [agg, todayCalls] = await Promise.all([
    db
      .select({
        total: count(),
        success: successFilter,
        avg: avgDuration,
        p95: p95Duration,
        p99: p99Duration,
        apps: sql<number>`count(distinct ${openApiCallLogs.clientId})`,
      })
      .from(openApiCallLogs)
      .where(where),
    db.$count(openApiCallLogs, todayWhere),
  ]);

  const total = Number(agg[0]?.total ?? 0);
  const success = Number(agg[0]?.success ?? 0);
  const failed = total - success;
  return {
    totalCalls: total,
    successCalls: success,
    failedCalls: failed,
    successRate: total > 0 ? Math.round((success / total) * 10000) / 100 : 0,
    avgDurationMs: Math.round(Number(agg[0]?.avg ?? 0)),
    p95DurationMs: Math.round(Number(agg[0]?.p95 ?? 0)),
    p99DurationMs: Math.round(Number(agg[0]?.p99 ?? 0)),
    activeApps: Number(agg[0]?.apps ?? 0),
    todayCalls: Number(todayCalls),
  };
}

export async function getOpenApiStatsTrend(opts: OpenApiStatsRangeInput & { granularity?: 'hour' | 'day' }) {
  const conds = rangeConditions(opts);
  const where = conds.length ? and(...conds) : undefined;
  const bucket =
    opts.granularity === 'hour'
      ? sql<string>`to_char(${openApiCallLogs.createdAt}, 'YYYY-MM-DD HH24:00:00')`
      : sql<string>`to_char(${openApiCallLogs.createdAt}, 'YYYY-MM-DD')`;

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

async function groupBy(opts: OpenApiStatsRangeInput & { limit?: number }, column: typeof openApiCallLogs.clientId | typeof openApiCallLogs.path, withName: boolean) {
  const conds = rangeConditions(opts);
  const where = conds.length ? and(...conds) : undefined;
  const limit = opts.limit ?? 10;
  const label = withName
    ? sql<string>`coalesce(max(${openApiCallLogs.appName}), ${column})`
    : sql<string>`${column}`;

  const rows = await db
    .select({ key: column, label, total: count(), success: successFilter, avg: avgDuration })
    .from(openApiCallLogs)
    .where(where)
    .groupBy(column)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  return rows.map((r) => {
    const total = Number(r.total);
    const success = Number(r.success);
    return {
      key: r.key,
      label: r.label,
      total,
      success,
      failed: total - success,
      avgDurationMs: Math.round(Number(r.avg)),
    };
  });
}

export function getOpenApiStatsByApp(opts: OpenApiStatsRangeInput & { limit?: number }) {
  return groupBy(opts, openApiCallLogs.clientId, true);
}

export function getOpenApiStatsByEndpoint(opts: OpenApiStatsRangeInput & { limit?: number }) {
  return groupBy(opts, openApiCallLogs.path, false);
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
