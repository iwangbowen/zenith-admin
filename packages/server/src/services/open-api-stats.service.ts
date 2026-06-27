import { and, gte, lte, eq, or, ilike, desc, sql, count, type SQL } from 'drizzle-orm';
import dayjs from 'dayjs';
import { db } from '../db';
import { openApiCallLogs } from '../db/schema';
import { formatDateTime, parseDateRangeStart, parseDateRangeEnd } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';

interface RangeInput {
  startTime?: string;
  endTime?: string;
}

function rangeConditions(opts: RangeInput): SQL[] {
  const conds: SQL[] = [];
  const start = parseDateRangeStart(opts.startTime);
  const end = parseDateRangeEnd(opts.endTime);
  if (start) conds.push(gte(openApiCallLogs.createdAt, start));
  if (end) conds.push(lte(openApiCallLogs.createdAt, end));
  return conds;
}

const successFilter = sql<number>`count(*) filter (where ${openApiCallLogs.success} = true)`;
const avgDuration = sql<number>`coalesce(avg(${openApiCallLogs.durationMs}), 0)`;

export async function getOpenApiStatsOverview(opts: RangeInput) {
  const conds = rangeConditions(opts);
  const where = conds.length ? and(...conds) : undefined;

  const todayStart = dayjs().startOf('day').toDate();

  const [agg, todayCalls] = await Promise.all([
    db
      .select({
        total: count(),
        success: successFilter,
        avg: avgDuration,
        apps: sql<number>`count(distinct ${openApiCallLogs.clientId})`,
      })
      .from(openApiCallLogs)
      .where(where),
    db.$count(openApiCallLogs, gte(openApiCallLogs.createdAt, todayStart)),
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
    activeApps: Number(agg[0]?.apps ?? 0),
    todayCalls: Number(todayCalls),
  };
}

export async function getOpenApiStatsTrend(opts: RangeInput & { granularity?: 'hour' | 'day' }) {
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

async function groupBy(opts: RangeInput & { limit?: number }, column: typeof openApiCallLogs.clientId | typeof openApiCallLogs.path, withName: boolean) {
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

export function getOpenApiStatsByApp(opts: RangeInput & { limit?: number }) {
  return groupBy(opts, openApiCallLogs.clientId, true);
}

export function getOpenApiStatsByEndpoint(opts: RangeInput & { limit?: number }) {
  return groupBy(opts, openApiCallLogs.path, false);
}

export async function listOpenApiCallLogs(opts: {
  page: number;
  pageSize: number;
  clientId?: string;
  success?: boolean;
  keyword?: string;
  startTime?: string;
  endTime?: string;
}) {
  const { page, pageSize, clientId, success, keyword } = opts;
  const conds = rangeConditions(opts);
  if (clientId) conds.push(eq(openApiCallLogs.clientId, clientId));
  if (typeof success === 'boolean') conds.push(eq(openApiCallLogs.success, success));
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(openApiCallLogs.path, kw), ilike(openApiCallLogs.appName, kw)) as SQL);
  }
  const where = conds.length ? and(...conds) : undefined;

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
      createdAt: formatDateTime(r.createdAt),
    })),
    total,
    page,
    pageSize,
  };
}
