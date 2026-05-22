import { desc, eq, like, and, gte, lte } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { loginLogs } from '../db/schema';
import { streamToExcel, formatDateTimeForExcel, batchIterable } from '../lib/excel-export';
import { tenantCondition } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';

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
