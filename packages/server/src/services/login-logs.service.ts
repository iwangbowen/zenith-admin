import { desc, eq, like, and, gte, lte } from 'drizzle-orm';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { db } from '../db';
import { loginLogs } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { exportToExcel, formatDateTimeForExcel } from '../lib/excel-export';
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
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(loginLogs, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, rows] = await Promise.all([
    db.$count(loginLogs, finalWhere),
    db.select().from(loginLogs).where(finalWhere).orderBy(desc(loginLogs.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return {
    list: rows.map((r) => ({ ...r, createdAt: formatDateTime(r.createdAt) })),
    total,
    page,
    pageSize,
  };
}

export async function exportLoginLogs(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(loginLogs).where(tenantCondition(loginLogs, user)).orderBy(desc(loginLogs.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '用户名', key: 'username', width: 16 },
      { header: 'IP', key: 'ip', width: 18 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'success' ? '成功' : '失败') },
      { header: '消息', key: 'message', width: 30 },
      { header: '登录时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, message: r.message ?? '', createdAt: formatDateTimeForExcel(r.createdAt) })),
    '登录日志',
  );
  return { buffer, filename: 'login-logs.xlsx' };
}
