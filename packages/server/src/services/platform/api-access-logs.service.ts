import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { db } from '../../db';
import { apiAccessLogs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { tenantCondition } from '../../lib/tenant';

export type ApiAccessLogsListFilter = Omit<QueryOutputOf<typeof apiAccessLogContract.list>, 'page' | 'pageSize'>;

function contentCondition(keyword: string | undefined) {
  const trimmed = keyword?.trim();
  if (!trimmed) return undefined;
  const escaped = trimmed.replaceAll('\\', String.raw`\\`).replaceAll('%', String.raw`\%`).replaceAll('_', String.raw`\_`);
  const pattern = `%${escaped}%`;
  return or(ilike(sql`${apiAccessLogs.queryParams}::text`, pattern), ilike(sql`${apiAccessLogs.requestBody}::text`, pattern));
}

export function buildApiAccessLogsWhere(q: ApiAccessLogsListFilter) {
  const user = currentUser();
  return buildWhere(
    q.userId ? eq(apiAccessLogs.userId, q.userId) : undefined,
    keywordCondition(q.username, [apiAccessLogs.username]),
    keywordCondition(q.principalType, [apiAccessLogs.principalType]),
    keywordCondition(q.authType, [apiAccessLogs.authType]),
    keywordCondition(q.module, [apiAccessLogs.module]),
    keywordCondition(q.operationKey, [apiAccessLogs.operationKey]),
    q.method ? eq(apiAccessLogs.method, q.method.toUpperCase()) : undefined,
    keywordCondition(q.path, [apiAccessLogs.path]),
    keywordCondition(q.routePath, [apiAccessLogs.routePath]),
    keywordCondition(q.requestId, [apiAccessLogs.requestId], 'like', 'prefix'),
    contentCondition(q.content),
    q.status === 'success' ? and(gte(apiAccessLogs.responseCode, 200), lte(apiAccessLogs.responseCode, 399)) : undefined,
    q.status === 'fail' ? gte(apiAccessLogs.responseCode, 400) : undefined,
    ...dateRangeConditions(apiAccessLogs.createdAt, q.startTime, q.endTime),
    q.minDurationMs != null ? gte(apiAccessLogs.durationMs, q.minDurationMs) : undefined,
    q.maxDurationMs != null ? lte(apiAccessLogs.durationMs, q.maxDurationMs) : undefined,
    tenantCondition(apiAccessLogs, user),
  );
}

function mapApiAccessLog(row: typeof apiAccessLogs.$inferSelect) {
  return { ...row, createdAt: formatDateTime(row.createdAt) };
}

export async function listApiAccessLogs(q: QueryOutputOf<typeof apiAccessLogContract.list>) {
  const where = buildApiAccessLogsWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(apiAccessLogs, where),
    rows: () => withPagination(db.select().from(apiAccessLogs).where(where).orderBy(desc(apiAccessLogs.createdAt), desc(apiAccessLogs.id)).$dynamic(), q.page, q.pageSize),
    map: mapApiAccessLog,
  });
}

export async function getApiAccessLog(id: number) {
  const [row] = await db.select().from(apiAccessLogs).where(and(eq(apiAccessLogs.id, id), tenantCondition(apiAccessLogs, currentUser()))).limit(1);
  requireRow(row, 'API 访问日志不存在');
  return mapApiAccessLog(row);
}

