import { count, desc, like, and, gte, lte, sql, eq } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { streamToExcel, streamToCsv, batchIterable, formatDateTimeForExcel } from '../lib/excel-export';
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
  minDurationMs?: number;
  maxDurationMs?: number;
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
  if (q.minDurationMs != null) conditions.push(gte(operationLogs.durationMs, q.minDurationMs));
  if (q.maxDurationMs != null) conditions.push(lte(operationLogs.durationMs, q.maxDurationMs));
  const where = and(...conditions);
  const tc = tenantCondition(operationLogs, user);
  return mergeWhere(where, tc);
}

export async function listOperationLogs(q: ListOperationLogsQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const finalWhere = buildWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(operationLogs, finalWhere),
    withPagination(db.select().from(operationLogs).where(finalWhere).orderBy(desc(operationLogs.createdAt)).$dynamic(), page, pageSize),
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
  const userCount = count();
  const methodCount = count();
  const hourlyCount = count();
  const moduleTimingCount = count();
  const [summaryRows, moduleStats, moduleTimingStats, dailyStats, userStats, methodStats, hourlyStats] = await Promise.all([
    db.select({
      total: count(),
      successCount: sql<number>`(count(case when ${operationLogs.responseCode} >= 200 and ${operationLogs.responseCode} < 400 then 1 end))::integer`,
      failCount: sql<number>`(count(case when ${operationLogs.responseCode} >= 400 then 1 end))::integer`,
      avgDurationMs: sql<number | null>`round(avg(${operationLogs.durationMs}))::float`,
      uniqueUsers: sql<number>`(count(distinct ${operationLogs.userId}))::integer`,
    }).from(operationLogs).where(baseWhere),
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
    }).from(operationLogs).where(baseWhere).groupBy(sql`date(${operationLogs.createdAt})`).orderBy(sql`date(${operationLogs.createdAt})`),
    db.select({ username: operationLogs.username, count: userCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.username).orderBy(desc(userCount)).limit(10),
    db.select({ method: operationLogs.method, count: methodCount }).from(operationLogs).where(baseWhere).groupBy(operationLogs.method).orderBy(desc(methodCount)),
    db.select({
      hour: sql<number>`(extract(hour from ${operationLogs.createdAt}))::integer`,
      count: hourlyCount,
    }).from(operationLogs).where(baseWhere).groupBy(sql`extract(hour from ${operationLogs.createdAt})`).orderBy(sql`extract(hour from ${operationLogs.createdAt})`),
  ]);
  const s = summaryRows[0] ?? { total: 0, successCount: 0, failCount: 0, avgDurationMs: null, uniqueUsers: 0 };
  const hourlyMap = new Map(hourlyStats.map((r) => [r.hour, r.count]));
  return {
    summary: {
      total: s.total,
      successCount: Number(s.successCount),
      failCount: Number(s.failCount),
      avgDurationMs: s.avgDurationMs == null ? null : Math.round(Number(s.avgDurationMs)),
      uniqueUsers: Number(s.uniqueUsers),
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
    })),
    userStats: userStats.map((r) => ({ username: r.username ?? '未知用户', count: r.count })),
    methodStats: methodStats.map((r) => ({ method: r.method, count: r.count })),
    hourlyStats: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourlyMap.get(h) ?? 0 })),
  };
}

const EXPORT_COLUMNS = [
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
];

function mapRowForExport(r: typeof operationLogs.$inferSelect) {
  return {
    ...r,
    duration: r.durationMs ?? '',
    createdAt: formatDateTimeForExcel(r.createdAt),
  } as Record<string, unknown>;
}

async function* streamExportRows(finalWhere: ReturnType<typeof buildWhere>) {
  for await (const r of batchIterable((limit, offset) =>
    db.select().from(operationLogs).where(finalWhere).orderBy(desc(operationLogs.id)).limit(limit).offset(offset),
  )) {
    yield mapRowForExport(r);
  }
}

export async function exportOperationLogs(q: ListOperationLogsQuery = {}): Promise<{ stream: ReadableStream; filename: string }> {
  const finalWhere = buildWhere(q);
  const stream = await streamToExcel(EXPORT_COLUMNS, streamExportRows(finalWhere), '操作日志');
  return { stream, filename: 'operation-logs.xlsx' };
}

export async function exportOperationLogsAsCsv(q: ListOperationLogsQuery = {}): Promise<{ stream: ReadableStream; filename: string }> {
  const finalWhere = buildWhere(q);
  const stream = streamToCsv(EXPORT_COLUMNS, streamExportRows(finalWhere));
  return { stream, filename: 'operation-logs.csv' };
}

function buildCleanOperationLogsWhere(months: number) {
  if (months === 0) return undefined;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return lte(operationLogs.createdAt, cutoff);
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

export async function getCleanOperationLogsBeforeAudit(months: number) {
  const where = buildCleanOperationLogsWhere(months);
  const [total, sample] = await Promise.all([
    db.$count(operationLogs, where),
    db.select().from(operationLogs).where(where).orderBy(desc(operationLogs.createdAt)).limit(20),
  ]);
  return { months, total, sample: sample.map(mapOperationLogForAudit) };
}

export async function cleanOperationLogs(months: number) {
  const where = buildCleanOperationLogsWhere(months);
  const result = where
    ? await db.delete(operationLogs).where(where).returning({ id: operationLogs.id })
    : await db.delete(operationLogs).returning({ id: operationLogs.id });
  return result.length;
}
