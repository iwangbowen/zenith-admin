import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { smsSendLogs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildListWhere, type SmsSendLogListFilter } from '../../../services/messaging/sms-send-logs.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'phone', header: '手机号', width: 16, sensitive: true, maskKey: 'SmsSendLog.phone' },
  { key: 'provider', header: '服务商', width: 12 },
  { key: 'content', header: '内容', width: 40 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'errorMsg', header: '错误信息', width: 24 },
  { key: 'bizId', header: '业务流水号', width: 24 },
  { key: 'source', header: '来源', width: 10 },
  { key: 'sentAt', header: '发送时间', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const smsSendLogsExportDefinition = defineExport<SmsSendLogListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.sms-send-logs',
  moduleName: '短信发送记录',
  filenamePrefix: '短信发送记录',
  sourcePath: '/system/sms-send-logs',
  sheetName: '短信发送记录',
  permissions: { export: 'system:sms-send-log:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(smsSendLogs, buildListWhere(query)),
  streamRows: async (query) => {
    const where = buildListWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(smsSendLogs).where(where).orderBy(desc(smsSendLogs.id)).limit(limit).offset(offset),
    );
  },
});
