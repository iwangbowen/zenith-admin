import { desc, eq, like, and, gte, lte, count, sql } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { loginLogs } from '../db/schema';
import { streamToExcel, streamToCsv, formatDateTimeForExcel, batchIterable } from '../lib/excel-export';
import { tenantCondition } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { formatDateTime, formatDate, parseDateTimeInput } from '../lib/datetime';

export interface ListLoginLogsQuery {
  page?: number;
  pageSize?: number;
  username?: string;
  status?: 'success' | 'fail';
  startTime?: string;
  endTime?: string;
}

export async function listLoginLogs(q: ListLoginLogsQuery) {
  const user = currentUser();
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const conditions = [];
  if (q.username) conditions.push(like(loginLogs.username, `%${escapeLike(q.username)}%`));
  if (q.status) conditions.push(eq(loginLogs.status, q.status));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(loginLogs.createdAt, startTime));
  if (endTime) conditions.push(lte(loginLogs.createdAt, endTime));
  const where = and(...conditions);
  const tc = tenantCondition(loginLogs, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, rows] = await Promise.all([
    db.$count(loginLogs, finalWhere),
    withPagination(db.select().from(loginLogs).where(finalWhere).orderBy(desc(loginLogs.createdAt)).$dynamic(), page, pageSize),
  ]);
  return {
    list: rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) })),
    total,
    page,
    pageSize,
  };
}

export async function loginLogStats(daysRaw?: number) {
  const user = currentUser();
  const days = Math.min(Math.max(Number(daysRaw) || 90, 7), 365);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startDateLabel = formatDate(startDate);
  const tc = tenantCondition(loginLogs, user);
  const baseWhere = tc ? and(gte(loginLogs.createdAt, startDate), tc) : gte(loginLogs.createdAt, startDate);

  const [summaryRows, dailyStats, userStats, ipStats, ipFailStats, browserStats, osStats, hourlyRaw] = await Promise.all([
    db.select({
      total: count(),
      successCount: sql<number>`(count(case when ${loginLogs.status} = 'success' then 1 end))::integer`,
      failCount: sql<number>`(count(case when ${loginLogs.status} = 'fail' then 1 end))::integer`,
      uniqueUsers: sql<number>`(count(distinct ${loginLogs.username}))::integer`,
    }).from(loginLogs).where(baseWhere),
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
  ]);

  const s = summaryRows[0] ?? { total: 0, successCount: 0, failCount: 0, uniqueUsers: 0 };
  const hourlyMap = new Map(hourlyRaw.map((r) => [r.hour, r.cnt]));

  return {
    summary: {
      total: s.total,
      successCount: Number(s.successCount),
      failCount: Number(s.failCount),
      uniqueUsers: Number(s.uniqueUsers),
    },
    dailyStats: dailyStats.map((r) => ({
      date: r.date || startDateLabel,
      count: r.count,
      successCount: Number(r.successCount),
      failCount: Number(r.failCount),
    })),
    userStats: userStats.map((r) => ({ username: r.username, count: r.cnt })),
    ipStats: ipStats.map((r) => ({ ip: r.ip ?? '未知', count: r.cnt })),
    ipFailStats: ipFailStats.map((r) => ({ ip: r.ip ?? '未知', count: r.cnt })),
    browserStats: browserStats.map((r) => ({ browser: r.browser ?? '未知', count: r.cnt })),
    osStats: osStats.map((r) => ({ os: r.os ?? '未知', count: r.cnt })),
    hourlyStats: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourlyMap.get(h) ?? 0 })),
  };
}

export async function exportLoginLogs(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const tc = tenantCondition(loginLogs, user);
  // Use batchIterable to stream rows from DB in 2000-row batches instead of loading
  // the entire table into memory before starting the Excel write.
  const rows = batchIterable(
    (limit, offset) =>
      db.select().from(loginLogs).where(tc).orderBy(desc(loginLogs.id)).limit(limit).offset(offset),
  );
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: 'IP', key: 'ip', width: 18 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'success' ? '成功' : '失败') },
      { header: '消息', key: 'message', width: 30, transform: (v) => (v as string | null) ?? '' },
      { header: '浏览器', key: 'browser', width: 16, transform: (v) => (v as string | null) ?? '' },
      { header: '操作系统', key: 'os', width: 16, transform: (v) => (v as string | null) ?? '' },
      { header: 'User-Agent', key: 'userAgent', width: 60, transform: (v) => (v as string | null) ?? '' },
      { header: '登录时间', key: 'createdAt', width: 22, transform: (v) => formatDateTimeForExcel(v as Date) },
    ],
    rows,
    '登录日志',
  );
  return { stream, filename: 'login-logs.xlsx' };
}

export async function exportLoginLogsAsCsv(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const tc = tenantCondition(loginLogs, user);
  const rows = batchIterable(
    (limit, offset) =>
      db.select().from(loginLogs).where(tc).orderBy(desc(loginLogs.id)).limit(limit).offset(offset),
  );
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: 'IP', key: 'ip', width: 18 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'success' ? '成功' : '失败') },
      { header: '消息', key: 'message', width: 30, transform: (v) => (v as string | null) ?? '' },
      { header: '浏览器', key: 'browser', width: 16, transform: (v) => (v as string | null) ?? '' },
      { header: '操作系统', key: 'os', width: 16, transform: (v) => (v as string | null) ?? '' },
      { header: 'User-Agent', key: 'userAgent', width: 60, transform: (v) => (v as string | null) ?? '' },
      { header: '登录时间', key: 'createdAt', width: 22, transform: (v) => formatDateTimeForExcel(v as Date) },
    ],
    rows,
  );
  return { stream, filename: 'login-logs.csv' };
}
