import { desc, and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { ipAccessLogs } from '../../db/schema';
import { buildWhere, dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { truncateVarchar } from '../../lib/sanitize';
import logger from '../../lib/logger';

export interface ListIpAccessLogsQuery {
  page?: number;
  pageSize?: number;
  ip?: string;
  blockType?: 'blacklist' | 'whitelist';
  startTime?: string;
  endTime?: string;
}

export async function listIpAccessLogs(q: ListIpAccessLogsQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const conditions = [];
  conditions.push(keywordCondition(q.ip, [ipAccessLogs.ip]));
  if (q.blockType) conditions.push(eq(ipAccessLogs.blockType, q.blockType));
  conditions.push(...dateRangeConditions(ipAccessLogs.createdAt, q.startTime, q.endTime));
  const where = and(...conditions);
  const finalWhere = buildWhere(where);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(ipAccessLogs, finalWhere),
    rows: () => withPagination(
      db.select().from(ipAccessLogs).where(finalWhere).orderBy(desc(ipAccessLogs.createdAt)).$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => ({ ...r, createdAt: formatDateTime(r.createdAt), blockType: r.blockType as 'blacklist' | 'whitelist' }),
  });
}

export async function writeIpAccessLog(data: {
  ip: string;
  path: string;
  method: string;
  blockType: 'blacklist' | 'whitelist';
  userAgent?: string | null;
}) {
  try {
    // ip / path / ua 均为客户端可控输入，按列长截断；失败只告警，调用方 fire-and-forget 不受影响
    await db.insert(ipAccessLogs).values({
      ip: truncateVarchar(data.ip, 64) ?? '',
      path: truncateVarchar(data.path, 256) ?? '',
      method: truncateVarchar(data.method, 16) ?? '',
      blockType: data.blockType,
      userAgent: truncateVarchar(data.userAgent, 512),
    });
  } catch (err) {
    logger.warn('IP 访问拦截日志写入失败', { ip: data.ip?.slice(0, 64), blockType: data.blockType, error: err instanceof Error ? err.message : String(err) });
  }
}
