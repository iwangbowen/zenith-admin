import { count, desc, and, or, gte, lt, lte, sql, eq, inArray } from 'drizzle-orm';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import { operationLogs } from '../../db/schema';
import { tenantCondition } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatDate } from '../../lib/datetime';
import { getNicknameMap, findUsernamesByNickname } from '../../lib/user-nicknames';
import { buildListResult } from '../../lib/list-query';

export interface ListOperationLogsQuery {
  page?: number;
  pageSize?: number;
  username?: string;
  module?: string;
  description?: string;
  method?: string;
  path?: string;
  ip?: string;
  status?: 'success' | 'fail';
  /** 内容关键字：模糊匹配请求体与 before/after 快照（trgm 索引加速） */
  content?: string;
  startTime?: string;
  endTime?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
}

export async function buildOperationLogsWhere(q: ListOperationLogsQuery) {
  const user = currentUser();
  const conditions = [];
  if (q.username) {
    // 关键字同时匹配用户名与昵称（昵称先反查出用户名集合）
    const byNickname = await findUsernamesByNickname(q.username);
    const usernameLike = keywordCondition(q.username, [operationLogs.username]);
    conditions.push(byNickname.length > 0 ? or(usernameLike, inArray(operationLogs.username, byNickname)) : usernameLike);
  }
  conditions.push(keywordCondition(q.module, [operationLogs.module]));
  conditions.push(keywordCondition(q.description, [operationLogs.description]));
  if (q.method) conditions.push(eq(operationLogs.method, q.method));
  conditions.push(keywordCondition(q.path, [operationLogs.path]));
  conditions.push(keywordCondition(q.ip, [operationLogs.ip]));
  conditions.push(keywordCondition(q.content, [operationLogs.beforeData, operationLogs.afterData, operationLogs.requestBody], 'ilike'));
  if (q.status === 'success') conditions.push(and(gte(operationLogs.responseCode, 200), lte(operationLogs.responseCode, 399)));
  if (q.status === 'fail') conditions.push(gte(operationLogs.responseCode, 400));
  conditions.push(...dateRangeConditions(operationLogs.createdAt, q.startTime, q.endTime));
  if (q.minDurationMs != null) conditions.push(gte(operationLogs.durationMs, q.minDurationMs));
  if (q.maxDurationMs != null) conditions.push(lte(operationLogs.durationMs, q.maxDurationMs));
  const where = and(...conditions);
  const tc = tenantCondition(operationLogs, user);
  return buildWhere(where, tc);
}

export async function listOperationLogs(q: ListOperationLogsQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const finalWhere = await buildOperationLogsWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(operationLogs, finalWhere),
    rows: async () => {
      const rows = await withPagination(db.select().from(operationLogs).where(finalWhere).orderBy(desc(operationLogs.createdAt)).$dynamic(), page, pageSize);
      const nicknameMap = await getNicknameMap(rows.map((r) => r.username));
      return rows.map((r) => ({ ...r, nickname: r.username ? nicknameMap.get(r.username) ?? null : null, createdAt: formatDateTime(r.createdAt) }));
    },
  });
}

export async function operationLogStats(daysRaw?: number) {
  const user = currentUser();
  const days = Math.min(Math.max(Number(daysRaw) || 90, 7), 365);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startDateLabel = formatDate(startDate);
  const prevStartDate = new Date(startDate);
  prevStartDate.setDate(prevStartDate.getDate() - days);
  const tc = tenantCondition(operationLogs, user);
  const baseWhere = tc ? and(gte(operationLogs.createdAt, startDate), tc) : gte(operationLogs.createdAt, startDate);
  const prevWhere = tc
    ? and(gte(operationLogs.createdAt, prevStartDate), lt(operationLogs.createdAt, startDate), tc)
    : and(gte(operationLogs.createdAt, prevStartDate), lt(operationLogs.createdAt, startDate));
  const moduleCount = count();
  const userCount = count();
  const methodCount = count();
  const hourlyCount = count();
  const moduleTimingCount = count();
  const summarySelect = {
    total: count(),
    successCount: sql<number>`(count(case when ${operationLogs.responseCode} >= 200 and ${operationLogs.responseCode} < 400 then 1 end))::integer`,
    failCount: sql<number>`(count(case when ${operationLogs.responseCode} >= 400 then 1 end))::integer`,
    avgDurationMs: sql<number | null>`round(avg(${operationLogs.durationMs}))::float`,
    uniqueUsers: sql<number>`(count(distinct ${operationLogs.userId}))::integer`,
  };
  const [
    summaryRows, prevSummaryRows, percentileRows, moduleStats, moduleTimingStats, dailyStats, userStats, methodStats, hourlyStats,
    statusClassStats, durationHistogramRaw, slowPaths, failModuleStats, userModuleFlows,
  ] = await Promise.all([
    db.select(summarySelect).from(operationLogs).where(baseWhere),
    db.select(summarySelect).from(operationLogs).where(prevWhere),
    db.select({
      p50: sql<number | null>`(percentile_cont(0.5) within group (order by ${operationLogs.durationMs}))::float`,
      p95: sql<number | null>`(percentile_cont(0.95) within group (order by ${operationLogs.durationMs}))::float`,
      p99: sql<number | null>`(percentile_cont(0.99) within group (order by ${operationLogs.durationMs}))::float`,
    }).from(operationLogs).where(and(baseWhere, sql`${operationLogs.durationMs} is not null`)),
    db.select({ module: operationLogs.module, count: moduleCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.module).orderBy(desc(moduleCount)).limit(20),
    db.select({
      module: operationLogs.module,
      avgMs: sql<number>`round(avg(${operationLogs.durationMs}))::integer`,
      maxMs: sql<number>`max(${operationLogs.durationMs})::integer`,
      count: moduleTimingCount,
    }).from(operationLogs).where(and(baseWhere, sql`${operationLogs.durationMs} is not null`)).groupBy(operationLogs.module).orderBy(desc(sql<number>`round(avg(${operationLogs.durationMs}))`)).limit(15),
    db.select({
      date: sql<string>`to_char(date(${operationLogs.createdAt}), 'YYYY-MM-DD')`,
      count: count(),
      successCount: sql<number>`(count(case when ${operationLogs.responseCode} >= 200 and ${operationLogs.responseCode} < 400 then 1 end))::integer`,
      failCount: sql<number>`(count(case when ${operationLogs.responseCode} >= 400 then 1 end))::integer`,
      avgMs: sql<number | null>`round(avg(${operationLogs.durationMs}))::float`,
    }).from(operationLogs).where(baseWhere).groupBy(sql`date(${operationLogs.createdAt})`).orderBy(sql`date(${operationLogs.createdAt})`),
    db.select({ username: operationLogs.username, count: userCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.username).orderBy(desc(userCount)).limit(10),
    db.select({ method: operationLogs.method, count: methodCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.method).orderBy(desc(methodCount)),
    db.select({
      hour: sql<number>`(extract(hour from ${operationLogs.createdAt}))::integer`,
      count: hourlyCount,
    }).from(operationLogs).where(baseWhere).groupBy(sql`extract(hour from ${operationLogs.createdAt})`).orderBy(sql`extract(hour from ${operationLogs.createdAt})`),
    db.select({
      statusClass: sql<string>`(floor(${operationLogs.responseCode} / 100)::text || 'xx')`,
      cnt: count(),
    }).from(operationLogs).where(and(baseWhere, sql`${operationLogs.responseCode} is not null`))
      .groupBy(sql`floor(${operationLogs.responseCode} / 100)`).orderBy(sql`floor(${operationLogs.responseCode} / 100)`),
    db.select({
      bucket: sql<string>`case
        when ${operationLogs.durationMs} < 100 then '<100ms'
        when ${operationLogs.durationMs} < 500 then '100-500ms'
        when ${operationLogs.durationMs} < 1000 then '0.5-1s'
        when ${operationLogs.durationMs} < 3000 then '1-3s'
        else '>3s' end`,
      cnt: count(),
      bucketOrder: sql<number>`min(case
        when ${operationLogs.durationMs} < 100 then 0
        when ${operationLogs.durationMs} < 500 then 1
        when ${operationLogs.durationMs} < 1000 then 2
        when ${operationLogs.durationMs} < 3000 then 3
        else 4 end)`,
    }).from(operationLogs).where(and(baseWhere, sql`${operationLogs.durationMs} is not null`))
      .groupBy(sql`case
        when ${operationLogs.durationMs} < 100 then '<100ms'
        when ${operationLogs.durationMs} < 500 then '100-500ms'
        when ${operationLogs.durationMs} < 1000 then '0.5-1s'
        when ${operationLogs.durationMs} < 3000 then '1-3s'
        else '>3s' end`),
    db.select({
      path: operationLogs.path,
      avgMs: sql<number>`round(avg(${operationLogs.durationMs}))::integer`,
      maxMs: sql<number>`max(${operationLogs.durationMs})::integer`,
      cnt: count(),
    }).from(operationLogs).where(and(baseWhere, sql`${operationLogs.durationMs} is not null`))
      .groupBy(operationLogs.path).orderBy(desc(sql<number>`round(avg(${operationLogs.durationMs}))`)).limit(10),
    db.select({ module: operationLogs.module, cnt: count() }).from(operationLogs)
      .where(and(baseWhere, gte(operationLogs.responseCode, 400)))
      .groupBy(operationLogs.module).orderBy(desc(count())).limit(10),
    db.select({ username: operationLogs.username, module: operationLogs.module, cnt: count() })
      .from(operationLogs).where(and(baseWhere, sql`${operationLogs.username} is not null`, sql`${operationLogs.module} is not null`))
      .groupBy(operationLogs.username, operationLogs.module).orderBy(desc(count())).limit(40),
  ]);
  const s = summaryRows[0] ?? { total: 0, successCount: 0, failCount: 0, avgDurationMs: null, uniqueUsers: 0 };
  const ps = prevSummaryRows[0] ?? { total: 0, successCount: 0, failCount: 0, avgDurationMs: null, uniqueUsers: 0 };
  const pct = percentileRows[0] ?? { p50: null, p95: null, p99: null };
  const hourlyMap = new Map(hourlyStats.map((r) => [r.hour, r.count]));
  const nicknameMap = await getNicknameMap([
    ...userStats.map((r) => r.username),
    ...userModuleFlows.map((r) => r.username),
  ]);
  const nicknameOf = (username: string | null) => (username ? nicknameMap.get(username) ?? null : null);
  return {
    summary: {
      total: s.total,
      successCount: Number(s.successCount),
      failCount: Number(s.failCount),
      avgDurationMs: s.avgDurationMs == null ? null : Math.round(Number(s.avgDurationMs)),
      uniqueUsers: Number(s.uniqueUsers),
      p50DurationMs: pct.p50 == null ? null : Math.round(Number(pct.p50)),
      p95DurationMs: pct.p95 == null ? null : Math.round(Number(pct.p95)),
      p99DurationMs: pct.p99 == null ? null : Math.round(Number(pct.p99)),
    },
    prevSummary: {
      total: ps.total,
      successCount: Number(ps.successCount),
      failCount: Number(ps.failCount),
      avgDurationMs: ps.avgDurationMs == null ? null : Math.round(Number(ps.avgDurationMs)),
      uniqueUsers: Number(ps.uniqueUsers),
    },
    moduleStats: moduleStats.map((r) => ({ module: r.module ?? '未知模块', count: r.count })),
    moduleTimingStats: moduleTimingStats.map((r) => ({
      module: r.module ?? '未知模块',
      avgMs: Number(r.avgMs) || 0,
      maxMs: Number(r.maxMs) || 0,
      count: r.count,
    })),
    dailyStats: dailyStats.map((r) => ({
      date: r.date || startDateLabel,
      count: r.count,
      successCount: Number(r.successCount),
      failCount: Number(r.failCount),
      avgMs: r.avgMs == null ? null : Math.round(Number(r.avgMs)),
    })),
    userStats: userStats.map((r) => ({ username: r.username ?? '未知用户', nickname: nicknameOf(r.username), count: r.count })),
    methodStats: methodStats.map((r) => ({ method: r.method, count: r.count })),
    hourlyStats: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourlyMap.get(h) ?? 0 })),
    statusClassStats: statusClassStats.map((r) => ({ statusClass: r.statusClass, count: r.cnt })),
    durationHistogram: [...durationHistogramRaw]
      .sort((a, b) => Number(a.bucketOrder) - Number(b.bucketOrder))
      .map((r) => ({ bucket: r.bucket, count: r.cnt })),
    slowPaths: slowPaths.map((r) => ({ path: r.path, avgMs: Number(r.avgMs) || 0, maxMs: Number(r.maxMs) || 0, count: r.cnt })),
    failModuleStats: failModuleStats.map((r) => ({ module: r.module ?? '未知模块', count: r.cnt })),
    userModuleFlows: userModuleFlows.map((r) => ({ username: r.username ?? '未知用户', nickname: nicknameOf(r.username), module: r.module ?? '未知模块', count: r.cnt })),
  };
}

function buildCleanOperationLogsWhere(days: number) {
  return lte(operationLogs.createdAt, new Date(Date.now() - days * 86_400_000));
}

function mapOperationLogForAudit(row: typeof operationLogs.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    module: row.module,
    description: row.description,
    method: row.method,
    path: row.path,
    responseCode: row.responseCode,
    durationMs: row.durationMs,
    ip: row.ip,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function getCleanOperationLogsBeforeAudit(days: number) {
  const where = buildCleanOperationLogsWhere(days);
  const [total, sample] = await Promise.all([
    db.$count(operationLogs, where),
    db.select().from(operationLogs).where(where).orderBy(desc(operationLogs.createdAt)).limit(20),
  ]);
  return { days, total, sample: sample.map(mapOperationLogForAudit) };
}

/**
 * 手动清除指定天数之前的操作日志。
 * 复用统一保留框架的分批删除实现，避免一次性把待删主键载入内存。
 */
export async function cleanOperationLogs(days: number) {
  const { runPolicy } = await import('../../lib/retention');
  return runPolicy('operation_logs', { days });
}
