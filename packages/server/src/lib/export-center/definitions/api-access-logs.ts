import { desc } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { db } from '../../../db';
import { apiAccessLogs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildApiAccessLogsWhere, type ApiAccessLogsListFilter } from '../../../services/platform/api-access-logs.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'principalType', header: '主体类型', width: 14 },
  { key: 'authType', header: '认证方式', width: 14 },
  { key: 'username', header: '用户 / 标识', width: 20 },
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

type ExportQuery = Omit<QueryOutputOf<typeof apiAccessLogContract.list>, 'page' | 'pageSize'> & Record<string, unknown>;

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
  countRows: async (query) => db.$count(apiAccessLogs, buildApiAccessLogsWhere(query)),
  streamRows: (query: ExportQuery) => batchIterable((limit, offset) => db.select().from(apiAccessLogs).where(buildApiAccessLogsWhere(query)).orderBy(desc(apiAccessLogs.id)).limit(limit).offset(offset)),
});

