import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { openApiCallLogs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
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

export const openApiCallLogsExportDefinition = defineExport<ExportQuery, Record<string, unknown>>({
  entity: 'open-platform.call-logs',
  moduleName: '开放 API 调用日志',
  filenamePrefix: '开放API调用日志',
  sourcePath: '/open-platform/stats',
  sheetName: '调用日志',
  permissions: { export: 'open:stats:view' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 3 },
  columns,
  countRows: async (query) => db.$count(openApiCallLogs, buildOpenApiCallLogWhere(query)),
  streamRows: async (query) => {
    const where = buildOpenApiCallLogWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(openApiCallLogs).where(where).orderBy(desc(openApiCallLogs.id)).limit(limit).offset(offset),
    );
  },
});
