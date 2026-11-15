import { desc, eq } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { ipAccessLogContract } from '@zenith/shared/platform';
import { db } from '../../db';
import { ipAccessLogs } from '../../db/schema';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { entityMapper } from '../../lib/entity-map';
import { ipAccessLogSchema, type IpAccessBlockType } from '@zenith/shared/platform';
import type { NewIpAccessLog } from '../../db/schema';
import { createBoundedLogBuffer } from '../../lib/bounded-log-buffer';
import { listRows } from '../../lib/list-query';
import { truncateVarchar } from '../../lib/sanitize';

export async function listIpAccessLogs(q: QueryOutputOf<typeof ipAccessLogContract.list>) {
  const { page, pageSize } = q;
  const finalWhere = buildWhere(
    keywordCondition(q.ip, [ipAccessLogs.ip]),
    q.blockType ? eq(ipAccessLogs.blockType, q.blockType) : undefined,
    ...dateRangeConditions(ipAccessLogs.createdAt, q.startTime, q.endTime),
  );
  return listRows({
    page,
    pageSize,
    table: ipAccessLogs,
    where: finalWhere,
    orderBy: [desc(ipAccessLogs.createdAt)],
    map: entityMapper(ipAccessLogSchema, (row: typeof ipAccessLogs.$inferSelect) => ({ blockType: row.blockType as IpAccessBlockType })),
  });
}

const buffer = createBoundedLogBuffer<NewIpAccessLog>('[ip-access-log]', async (entries) => {
  await db.insert(ipAccessLogs).values(entries);
});
export const flushIpAccessLogs = buffer.flush;
export const stopIpAccessLogs = buffer.stop;
export const ipAccessLogStats = buffer.stats;

export function writeIpAccessLog(data: {
  ip: string;
  path: string;
  method: string;
  blockType: IpAccessBlockType;
  matchedEntry?: string | null;
  policyVersion?: number | null;
  correlationId?: string | null;
  userAgent?: string | null;
}) {
  buffer.enqueue({
    ip: truncateVarchar(data.ip, 64) ?? '',
    path: truncateVarchar(data.path, 256) ?? '',
    method: truncateVarchar(data.method, 16) ?? '',
    blockType: data.blockType,
    userAgent: truncateVarchar(data.userAgent, 512),
    matchedEntry: truncateVarchar(data.matchedEntry, 64),
    policyVersion: data.policyVersion ?? null,
    correlationId: truncateVarchar(data.correlationId, 64),
  });
}
