import { desc, lt, lte } from 'drizzle-orm';
import { API_ACCESS_CREDENTIAL_LABELS, API_ACCESS_ACCESSOR_TYPE_LABELS, apiAccessLogListQuery } from '@zenith/shared/platform';
import { db } from '../../../db/index';
import { apiAccessLogs } from '../../../db/schema';
import { buildApiAccessLogsWhere, apiAccessLogSummaryColumns, assertApiAccessLogScope, type ApiAccessLogsListFilter } from '../api-access-logs.service';
import { buildWhere } from '../../../lib/where-helpers';
import type { JwtPayload } from '../../../middleware/auth';
import { defineExport } from '../../../lib/export-center/registry';
import type { ExportColumn } from '../../../lib/export-center/types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'accessorType', header: '访问端类型', width: 14, enumMap: API_ACCESS_ACCESSOR_TYPE_LABELS },
  { key: 'credentialType', header: '凭证方式', width: 14, enumMap: API_ACCESS_CREDENTIAL_LABELS },
  { key: 'accessorName', header: '访问人 / 调用方', width: 20 },
  { key: 'accessorId', header: '访问人 / 调用方 ID', width: 28 },
  { key: 'method', header: '方法', width: 10 },
  { key: 'path', header: '请求地址', width: 42 },
  { key: 'routePath', header: '路由模板', width: 36 },
  { key: 'module', header: '模块', width: 18 },
  { key: 'operationName', header: '操作', width: 28 },
  { key: 'responseCode', header: '状态码', width: 10, type: 'number' },
  { key: 'durationMs', header: '耗时(ms)', width: 12, type: 'number' },
  { key: 'ip', header: 'IP', width: 18 },
  { key: 'requestId', header: '请求 ID', width: 38 },
  { key: 'createdAt', header: '请求时间', width: 22, type: 'datetime' },
];

const filterSchema = apiAccessLogListQuery.omit({ page: true, pageSize: true });
function normalizeQuery(query: Record<string, unknown>) {
  return filterSchema.parse(query);
}

async function* streamRows(query: ApiAccessLogsListFilter, user: JwtPayload) {
  const where = buildApiAccessLogsWhere(query, user);
  const [max] = await db.select({ id: apiAccessLogs.id }).from(apiAccessLogs).where(where).orderBy(desc(apiAccessLogs.id)).limit(1);
  if (!max) return;
  let cursor: number | undefined;
  while (true) {
    const rows = await db.select(apiAccessLogSummaryColumns).from(apiAccessLogs)
      .where(buildWhere(where, lte(apiAccessLogs.id, max.id), cursor === undefined ? undefined : lt(apiAccessLogs.id, cursor)))
      .orderBy(desc(apiAccessLogs.id)).limit(1000);
    if (rows.length === 0) return;
    yield* rows;
    cursor = rows[rows.length - 1].id;
  }
}

export const apiAccessLogsExportDefinition = defineExport<ApiAccessLogsListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.api-access-logs',
  moduleName: 'API 访问日志',
  filenamePrefix: 'API访问日志',
  sourcePath: '/system/api-access-logs',
  sheetName: 'API访问日志',
  permissions: { export: 'system:api-access-log:export' },
  execution: { mode: 'auto', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: false },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 3 },
  columns,
  prepareQuery: async (query, user) => { assertApiAccessLogScope(user); return normalizeQuery(query); },
  countRows: async (query, user) => db.$count(apiAccessLogs, buildApiAccessLogsWhere(normalizeQuery(query), user)),
  streamRows: (query, user) => streamRows(normalizeQuery(query), user),
});
