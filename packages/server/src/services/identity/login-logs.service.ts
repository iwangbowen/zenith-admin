import { buildListResult } from '../../lib/list-query';
import { desc, eq, and, or, gte, lt, lte, count, sql, inArray, type SQL } from 'drizzle-orm';
import { buildWhere, dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { db } from '../../db';
import { loginLogs } from '../../db/schema';
import { tenantCondition } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { formatDateTime, resolveStatsWindow } from '../../lib/datetime';
import { getNicknameMap, findUsernamesByNickname } from '../../lib/user-nicknames';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { loginLogContract } from '@zenith/shared/identity';

export async function listLoginLogs(q: QueryOutputOf<typeof loginLogContract.list>) {
  const user = currentUser();
  const { page, pageSize } = q;
  let usernameCondition: SQL | undefined;
  if (q.username) {
    // 关键字同时匹配用户名与昵称（昵称先反查出用户名集合）
    const byNickname = await findUsernamesByNickname(q.username);
    const usernameLike = keywordCondition(q.username, [loginLogs.username]);
    usernameCondition = byNickname.length > 0 ? or(usernameLike, inArray(loginLogs.username, byNickname)) : usernameLike;
  }
  const tc = tenantCondition(loginLogs, user);
  const finalWhere = buildWhere(
    usernameCondition,
    q.eventType ? eq(loginLogs.eventType, q.eventType) : undefined,
    q.status ? eq(loginLogs.status, q.status) : undefined,
    ...dateRangeConditions(loginLogs.createdAt, q.startTime, q.endTime),
    tc,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(loginLogs, finalWhere),
    rows: async () => {
      const rows = await withPagination(db.select().from(loginLogs).where(finalWhere).orderBy(desc(loginLogs.createdAt)).$dynamic(), page, pageSize);
      const nicknameMap = await getNicknameMap(rows.map((r) => r.username));
      return rows.map((r) => ({ ...r, nickname: nicknameMap.get(r.username) ?? null, createdAt: formatDateTime(r.createdAt) }));
    },
  });
}

export async function loginLogStats(daysRaw?: number) {
  const user = currentUser();
  const { startDate, startDateLabel, prevStartDate } = resolveStatsWindow(daysRaw);
  const tc = tenantCondition(loginLogs, user);
  const baseWhere = buildWhere(gte(loginLogs.createdAt, startDate), eq(loginLogs.eventType, 'login'), tc);
  const prevWhere = buildWhere(gte(loginLogs.createdAt, prevStartDate), lt(loginLogs.createdAt, startDate), eq(loginLogs.eventType, 'login'), tc);

  const summarySelect = {
    total: count(),
    successCount: sql<number>`(count(case when ${loginLogs.status} = 'success' then 1 end))::integer`,
    failCount: sql<number>`(count(case when ${loginLogs.status} = 'fail' then 1 end))::integer`,
    uniqueUsers: sql<number>`(count(distinct ${loginLogs.username}))::integer`,
  };

  const [
    summaryRows, prevSummaryRows, dailyStats, userStats, ipStats, ipFailStats, browserStats, osStats, hourlyRaw,
    failReasonStats, locationStats, dowHourRaw, resolutionStats, gpuStats,
  ] = await Promise.all([
    db.select(summarySelect).from(loginLogs).where(baseWhere),
    db.select(summarySelect).from(loginLogs).where(prevWhere),
    db.select({
      date: sql<string>`to_char(date(${loginLogs.createdAt}), 'YYYY-MM-DD')`,
      count: count(),
      successCount: sql<number>`(count(case when ${loginLogs.status} = 'success' then 1 end))::integer`,
      failCount: sql<number>`(count(case when ${loginLogs.status} = 'fail' then 1 end))::integer`,
    }).from(loginLogs).where(baseWhere).groupBy(sql`date(${loginLogs.createdAt})`).orderBy(sql`date(${loginLogs.createdAt})`),
    db.select({ username: loginLogs.username, cnt: count() }).from(loginLogs).where(baseWhere).groupBy(loginLogs.username).orderBy(desc(count())).limit(10),
    db.select({ ip: loginLogs.ip, cnt: count() }).from(loginLogs).where(and(baseWhere, sql`${loginLogs.ip} is not null`)).groupBy(loginLogs.ip).orderBy(desc(count())).limit(10),
    db.select({ ip: loginLogs.ip, cnt: count() }).from(loginLogs).where(and(baseWhere, eq(loginLogs.status, 'fail'), sql`${loginLogs.ip} is not null`)).groupBy(loginLogs.ip).orderBy(desc(count())).limit(10),
    db.select({ browser: loginLogs.browser, cnt: count() }).from(loginLogs).where(and(baseWhere, sql`${loginLogs.browser} is not null`)).groupBy(loginLogs.browser).orderBy(desc(count())).limit(10),
    db.select({ os: loginLogs.os, cnt: count() }).from(loginLogs).where(and(baseWhere, sql`${loginLogs.os} is not null`)).groupBy(loginLogs.os).orderBy(desc(count())).limit(10),
    db.select({
      hour: sql<number>`(extract(hour from ${loginLogs.createdAt}))::integer`,
      cnt: count(),
    }).from(loginLogs).where(baseWhere).groupBy(sql`extract(hour from ${loginLogs.createdAt})`).orderBy(sql`extract(hour from ${loginLogs.createdAt})`),
    db.select({ message: loginLogs.message, cnt: count() }).from(loginLogs).where(and(baseWhere, eq(loginLogs.status, 'fail'), sql`${loginLogs.message} is not null`)).groupBy(loginLogs.message).orderBy(desc(count())).limit(8),
    db.select({ location: loginLogs.location, cnt: count() }).from(loginLogs).where(and(baseWhere, sql`${loginLogs.location} is not null`)).groupBy(loginLogs.location).orderBy(desc(count())).limit(10),
    db.select({
      dow: sql<number>`(extract(isodow from ${loginLogs.createdAt}))::integer`,
      hour: sql<number>`(extract(hour from ${loginLogs.createdAt}))::integer`,
      cnt: count(),
    }).from(loginLogs).where(baseWhere)
      .groupBy(sql`extract(isodow from ${loginLogs.createdAt})`, sql`extract(hour from ${loginLogs.createdAt})`),
    db.select({
      resolution: sql<string>`(${loginLogs.screenWidth} || '×' || ${loginLogs.screenHeight})`,
      cnt: count(),
    }).from(loginLogs).where(and(baseWhere, sql`${loginLogs.screenWidth} is not null`, sql`${loginLogs.screenHeight} is not null`))
      .groupBy(loginLogs.screenWidth, loginLogs.screenHeight).orderBy(desc(count())).limit(8),
    db.select({ gpu: loginLogs.gpu, cnt: count() }).from(loginLogs).where(and(baseWhere, sql`${loginLogs.gpu} is not null`)).groupBy(loginLogs.gpu).orderBy(desc(count())).limit(8),
  ]);

  const s = summaryRows[0] ?? { total: 0, successCount: 0, failCount: 0, uniqueUsers: 0 };
  const ps = prevSummaryRows[0] ?? { total: 0, successCount: 0, failCount: 0, uniqueUsers: 0 };
  const hourlyMap = new Map(hourlyRaw.map((r) => [r.hour, r.cnt]));
  const dowHourMap = new Map(dowHourRaw.map((r) => [`${r.dow}-${r.hour}`, r.cnt]));
  const nicknameMap = await getNicknameMap(userStats.map((r) => r.username));

  return {
    summary: {
      total: s.total,
      successCount: Number(s.successCount),
      failCount: Number(s.failCount),
      uniqueUsers: Number(s.uniqueUsers),
    },
    prevSummary: {
      total: ps.total,
      successCount: Number(ps.successCount),
      failCount: Number(ps.failCount),
      uniqueUsers: Number(ps.uniqueUsers),
    },
    dailyStats: dailyStats.map((r) => ({
      date: r.date || startDateLabel,
      count: r.count,
      successCount: Number(r.successCount),
      failCount: Number(r.failCount),
    })),
    userStats: userStats.map((r) => ({ username: r.username, nickname: nicknameMap.get(r.username) ?? null, count: r.cnt })),
    ipStats: ipStats.map((r) => ({ ip: r.ip ?? '未知', count: r.cnt })),
    ipFailStats: ipFailStats.map((r) => ({ ip: r.ip ?? '未知', count: r.cnt })),
    browserStats: browserStats.map((r) => ({ browser: r.browser ?? '未知', count: r.cnt })),
    osStats: osStats.map((r) => ({ os: r.os ?? '未知', count: r.cnt })),
    hourlyStats: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourlyMap.get(h) ?? 0 })),
    failReasonStats: failReasonStats.map((r) => ({ message: r.message ?? '未知原因', count: r.cnt })),
    locationStats: locationStats.map((r) => ({ location: r.location ?? '未知', count: r.cnt })),
    // 展平为 7×24 完整矩阵，前端热力图无需再补零
    dowHourStats: Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => ({ dow: d + 1, hour: h, count: dowHourMap.get(`${d + 1}-${h}`) ?? 0 })),
    ).flat(),
    resolutionStats: resolutionStats.map((r) => ({ resolution: r.resolution, count: r.cnt })),
    gpuStats: gpuStats.map((r) => ({ gpu: r.gpu ?? '未知', count: r.cnt })),
  };
}

function buildCleanLoginLogsWhere(days: number) {
  return lte(loginLogs.createdAt, new Date(Date.now() - days * 86_400_000));
}

function mapLoginLogForAudit(row: typeof loginLogs.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    eventType: row.eventType,
    ip: row.ip,
    status: row.status,
    message: row.message,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function getCleanLoginLogsBeforeAudit(days: number) {
  const where = buildCleanLoginLogsWhere(days);
  const [total, sample] = await Promise.all([
    db.$count(loginLogs, where),
    db.select().from(loginLogs).where(where).orderBy(desc(loginLogs.createdAt)).limit(20),
  ]);
  return { days, total, sample: sample.map(mapLoginLogForAudit) };
}

/**
 * 手动清除指定天数之前的登录日志。
 * 复用统一保留框架的分批删除实现，避免一次性把待删主键载入内存。
 */
export async function cleanLoginLogs(days: number) {
  const { runPolicy } = await import('../../lib/retention');
  return runPolicy('login_logs', { days });
}
