import { count, desc, like, and, gte, lte, sql, eq } from 'drizzle-orm';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { exportToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { tenantCondition } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { formatDateTime, formatDate, parseDateTimeInput } from '../lib/datetime';

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
  startTime?: string;
  endTime?: string;
}

function buildWhere(q: ListOperationLogsQuery) {
  const user = currentUser();
  const conditions = [];
  if (q.username) conditions.push(like(operationLogs.username, `%${escapeLike(q.username)}%`));
  if (q.module) conditions.push(like(operationLogs.module, `%${escapeLike(q.module)}%`));
  if (q.description) conditions.push(like(operationLogs.description, `%${escapeLike(q.description)}%`));
  if (q.method) conditions.push(eq(operationLogs.method, q.method));
  if (q.path) conditions.push(like(operationLogs.path, `%${escapeLike(q.path)}%`));
  if (q.ip) conditions.push(like(operationLogs.ip, `%${escapeLike(q.ip)}%`));
  if (q.status === 'success') conditions.push(and(gte(operationLogs.responseCode, 200), lte(operationLogs.responseCode, 399)));
  if (q.status === 'fail') conditions.push(gte(operationLogs.responseCode, 400));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(operationLogs.createdAt, startTime));
  if (endTime) conditions.push(lte(operationLogs.createdAt, endTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(operationLogs, user);
  return mergeWhere(where, tc);
}

export async function listOperationLogs(q: ListOperationLogsQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const finalWhere = buildWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(operationLogs, finalWhere),
    db.select().from(operationLogs).where(finalWhere).orderBy(desc(operationLogs.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) })), total, page, pageSize };
}

export async function operationLogStats(daysRaw?: number) {
  const user = currentUser();
  const days = Math.min(Math.max(Number(daysRaw) || 90, 7), 365);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startDateLabel = formatDate(startDate);
  const tc = tenantCondition(operationLogs, user);
  const baseWhere = tc ? and(gte(operationLogs.createdAt, startDate), tc) : gte(operationLogs.createdAt, startDate);
  const moduleCount = count();
  const dailyCount = count();
  const userCount = count();
  const [moduleStats, dailyStats, userStats] = await Promise.all([
    db.select({ module: operationLogs.module, count: moduleCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.module).orderBy(desc(moduleCount)).limit(20),
    db.select({
      date: sql<string>`to_char(date(${operationLogs.createdAt}), 'YYYY-MM-DD')`,
      count: dailyCount,
    }).from(operationLogs).where(baseWhere).groupBy(sql`date(${operationLogs.createdAt})`).orderBy(sql`date(${operationLogs.createdAt})`),
    db.select({ username: operationLogs.username, count: userCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.username).orderBy(desc(userCount)).limit(10),
  ]);
  return {
    moduleStats: moduleStats.map((r) => ({ module: r.module ?? '未知模块', count: r.count })),
    dailyStats: dailyStats.map((r) => ({ date: r.date || startDateLabel, count: r.count })),
    userStats: userStats.map((r) => ({ username: r.username ?? '未知用户', count: r.count })),
  };
}

export async function exportOperationLogs(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(operationLogs).where(tenantCondition(operationLogs, user)).orderBy(desc(operationLogs.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 14 },
      { header: '模块', key: 'module', width: 14 },
      { header: '描述', key: 'description', width: 20 },
      { header: '方法', key: 'method', width: 8 },
      { header: '路径', key: 'path', width: 24 },
      { header: '状态码', key: 'responseCode', width: 10 },
      { header: '耗时(ms)', key: 'duration', width: 12 },
      { header: 'IP', key: 'ip', width: 16 },
      { header: '时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '操作日志',
  );
  return { buffer, filename: 'operation-logs.xlsx' };
}
