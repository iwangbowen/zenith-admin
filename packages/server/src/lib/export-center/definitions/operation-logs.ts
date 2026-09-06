import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { operationLogs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildOperationLogsWhere, type ListOperationLogsQuery } from '../../../services/platform/operation-logs.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'username', header: '用户名', width: 14 },
  { key: 'module', header: '模块', width: 14 },
  { key: 'description', header: '描述', width: 20 },
  { key: 'method', header: '方法', width: 8 },
  { key: 'path', header: '路径', width: 24 },
  { key: 'responseCode', header: '状态码', width: 10, type: 'number' },
  { key: 'durationMs', header: '耗时(ms)', width: 12, type: 'number' },
  { key: 'ip', header: 'IP', width: 16 },
  { key: 'createdAt', header: '时间', width: 22, type: 'datetime' },
];

export const operationLogsExportDefinition = defineExport<ListOperationLogsQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.operation-logs',
  moduleName: '操作日志',
  filenamePrefix: '操作日志',
  sourcePath: '/system/operation-logs',
  sheetName: '操作日志',
  permissions: { export: 'system:log:operation' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(operationLogs, await buildOperationLogsWhere(query)),
  streamRows: async (query) => {
    const where = await buildOperationLogsWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(operationLogs).where(where).orderBy(desc(operationLogs.id)).limit(limit).offset(offset),
    );
  },
});
