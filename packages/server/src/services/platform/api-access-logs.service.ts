import { and, desc, eq, getTableColumns, gte, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { apiAccessLogContract, apiAccessLogSchema, apiAccessLogListItemSchema } from '@zenith/shared/platform';
import { db } from '../../db';
import { apiAccessLogs } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { entityMapper } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { isPlatformAdmin, tenantCondition } from '../../lib/tenant';
import type { JwtPayload } from '../../middleware/auth';
import { config } from '../../config';

export type ApiAccessLogsListFilter = Omit<QueryOutputOf<typeof apiAccessLogContract.list>, 'page' | 'pageSize'>;

export function assertApiAccessLogScope(user: JwtPayload): void {
  if (config.multiTenantMode && !isPlatformAdmin(user)) throw new HTTPException(403, { message: '仅平台管理员可查看 API 访问日志' });
}

/** 列表/导出投影一致，禁止将请求快照与UA带入高频分页传输。 */
export const apiAccessLogSummaryColumns = (() => {
  const { queryParams: _query, requestBody: _body, userAgent: _agent, errorMessage: _message, ...columns } = getTableColumns(apiAccessLogs);
  return columns;
})();

export function buildApiAccessLogsWhere(q: ApiAccessLogsListFilter, user: JwtPayload = currentUser()) {
  assertApiAccessLogScope(user);
  return buildWhere(
    q.userId ? eq(apiAccessLogs.userId, q.userId) : undefined,
    q.memberId ? eq(apiAccessLogs.memberId, q.memberId) : undefined,
    q.deviceId ? eq(apiAccessLogs.deviceId, q.deviceId) : undefined,
    keywordCondition(q.accessorId, [apiAccessLogs.accessorId]),
    keywordCondition(q.clientId, [apiAccessLogs.clientId]),
    keywordCondition(q.accessorName, [apiAccessLogs.accessorName]),
    q.accessorType ? eq(apiAccessLogs.accessorType, q.accessorType) : undefined,
    q.credentialType ? eq(apiAccessLogs.credentialType, q.credentialType) : undefined,
    keywordCondition(q.module, [apiAccessLogs.module]),
    keywordCondition(q.operationKey, [apiAccessLogs.operationKey]),
    q.method ? eq(apiAccessLogs.method, q.method.toUpperCase()) : undefined,
    keywordCondition(q.path, [apiAccessLogs.path]),
    keywordCondition(q.routePath, [apiAccessLogs.routePath]),
    keywordCondition(q.correlationId, [apiAccessLogs.correlationId], 'like', 'prefix'),
    keywordCondition(q.content, [sql`${apiAccessLogs.queryParams}::text`, sql`${apiAccessLogs.requestBody}::text`], 'ilike'),
    keywordCondition(q.serviceName, [apiAccessLogs.serviceName]),
    keywordCondition(q.ip, [apiAccessLogs.ip]),
    q.responseCode != null ? eq(apiAccessLogs.responseCode, q.responseCode) : undefined,
    q.status === 'success' ? and(gte(apiAccessLogs.responseCode, 200), lte(apiAccessLogs.responseCode, 399)) : undefined,
    q.status === 'fail' ? gte(apiAccessLogs.responseCode, 400) : undefined,
    ...dateRangeConditions(apiAccessLogs.createdAt, q.startTime, q.endTime),
    q.minDurationMs != null ? gte(apiAccessLogs.durationMs, q.minDurationMs) : undefined,
    q.maxDurationMs != null ? lte(apiAccessLogs.durationMs, q.maxDurationMs) : undefined,
    tenantCondition(apiAccessLogs, user),
  );
}

const mapApiAccessLog = entityMapper(apiAccessLogSchema);
const mapApiAccessLogSummary = entityMapper(apiAccessLogListItemSchema);

export async function listApiAccessLogs(q: QueryOutputOf<typeof apiAccessLogContract.list>) {
  const where = buildApiAccessLogsWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(apiAccessLogs, where),
    rows: () => withPagination(db.select(apiAccessLogSummaryColumns).from(apiAccessLogs).where(where).orderBy(desc(apiAccessLogs.createdAt), desc(apiAccessLogs.id)).$dynamic(), q.page, q.pageSize),
    map: mapApiAccessLogSummary,
  });
}

export async function getApiAccessLog(id: number) {
  assertApiAccessLogScope(currentUser());
  const [row] = await db.select().from(apiAccessLogs).where(and(eq(apiAccessLogs.id, id), tenantCondition(apiAccessLogs, currentUser()))).limit(1);
  requireRow(row, 'API 访问日志不存在');
  return mapApiAccessLog(row);
}

