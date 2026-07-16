import { and, desc, lt, lte, type SQL } from 'drizzle-orm';
import { db } from '../../../db';
import { openApiCallLogs } from '../../../db/schema';
import {
  buildOpenApiCallLogWhere,
  type OpenApiCallLogQuery,
} from '../../../services/open-platform/open-api-stats.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'appName', header: '应用名称', width: 20 },
  { key: 'clientId', header: 'Client ID', width: 38 },
  { key: 'environment', header: '环境', width: 10, enumMap: { production: '生产', sandbox: '沙箱' } },
  { key: 'method', header: '方法', width: 10 },
  { key: 'path', header: '请求路径', width: 36 },
  { key: 'scope', header: 'Scope', width: 18 },
  { key: 'statusCode', header: '状态码', width: 10, type: 'number' },
  { key: 'success', header: '是否成功', width: 10, enumMap: { true: '成功', false: '失败' } },
  { key: 'durationMs', header: '耗时(ms)', width: 12, type: 'number' },
  { key: 'ip', header: 'IP', width: 18 },
  { key: 'requestId', header: '请求 ID', width: 24 },
  { key: 'errorMessage', header: '错误信息', width: 36 },
  { key: 'createdAt', header: '调用时间', width: 22, type: 'datetime' },
];

type ExportQuery = Omit<OpenApiCallLogQuery, 'page' | 'pageSize'> & Record<string, unknown>;

async function* streamOpenApiCallLogs(query: ExportQuery) {
  const baseWhere = buildOpenApiCallLogWhere(query);
  const [maxRow] = await db.select({ id: openApiCallLogs.id })
    .from(openApiCallLogs)
    .where(baseWhere)
    .orderBy(desc(openApiCallLogs.id))
    .limit(1);
  if (!maxRow) return;

  let cursor: number | null = null;
  while (true) {
    const conditions: SQL[] = [lte(openApiCallLogs.id, maxRow.id)];
    if (baseWhere) conditions.push(baseWhere);
    if (cursor !== null) conditions.push(lt(openApiCallLogs.id, cursor));
    const rows = await db.select().from(openApiCallLogs)
      .where(and(...conditions))
      .orderBy(desc(openApiCallLogs.id))
      .limit(1000);
    if (rows.length === 0) return;
    yield* rows;
    cursor = rows[rows.length - 1].id;
  }
}

export const openApiCallLogsExportDefinition = defineExport<ExportQuery, Record<string, unknown>>({
  entity: 'open-platform.call-logs',
  moduleName: '开放 API 调用日志',
  filenamePrefix: '开放API调用日志',
  sourcePath: '/open-platform/stats',
  sheetName: '调用日志',
  permissions: { export: 'open:stats:view' },
  execution: { mode: 'auto', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: false },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 3 },
  columns,
  countRows: async (query) => db.$count(openApiCallLogs, buildOpenApiCallLogWhere(query)),
  streamRows: (query) => streamOpenApiCallLogs(query),
});
