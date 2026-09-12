import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { loginLogs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildLoginLogsWhere, type LoginLogListFilter } from '../../../services/identity/login-logs.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const EVENT_LABELS: Record<string, string> = { login: '登录', logout: '退出登录' };
const STATUS_LABELS: Record<string, string> = { success: '成功', fail: '失败' };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'username', header: '用户名', width: 16 },
  { key: 'eventType', header: '事件类型', width: 12, enumMap: EVENT_LABELS },
  { key: 'ip', header: 'IP', width: 18 },
  { key: 'status', header: '状态', width: 10, enumMap: STATUS_LABELS },
  { key: 'message', header: '消息', width: 30 },
  { key: 'browser', header: '浏览器', width: 16 },
  { key: 'os', header: '操作系统', width: 16 },
  { key: 'userAgent', header: 'User-Agent', width: 60 },
  { key: 'createdAt', header: '操作时间', width: 22, type: 'datetime' },
];

export const loginLogsExportDefinition = defineExport<LoginLogListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.login-logs',
  moduleName: '登录日志',
  filenamePrefix: '登录日志',
  sourcePath: '/system/login-logs',
  sheetName: '登录日志',
  permissions: { export: 'system:log:login' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  // buildLoginLogsWhere 已含租户可见性条件
  countRows: async (query) => db.$count(loginLogs, await buildLoginLogsWhere(query)),
  streamRows: async (query) => {
    const where = await buildLoginLogsWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(loginLogs).where(where).orderBy(desc(loginLogs.id)).limit(limit).offset(offset),
    );
  },
});
