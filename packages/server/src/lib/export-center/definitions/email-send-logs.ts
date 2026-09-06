import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { emailSendLogs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildListWhere, type ListEmailSendLogsQuery } from '../../../services/messaging/email-send-logs.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'toEmail', header: '收件邮箱', width: 26, sensitive: true, maskKey: 'EmailSendLog.toEmail' },
  { key: 'subject', header: '主题', width: 30 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'errorMsg', header: '错误信息', width: 24 },
  { key: 'source', header: '来源', width: 10 },
  { key: 'sentAt', header: '发送时间', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const emailSendLogsExportDefinition = defineExport<ListEmailSendLogsQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.email-send-logs',
  moduleName: '邮件发送记录',
  filenamePrefix: '邮件发送记录',
  sourcePath: '/system/email-send-logs',
  sheetName: '邮件发送记录',
  permissions: { export: 'system:email-send-log:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => db.$count(emailSendLogs, buildListWhere(query)),
  streamRows: async (query) => {
    const where = buildListWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(emailSendLogs).where(where).orderBy(desc(emailSendLogs.id)).limit(limit).offset(offset),
    );
  },
});
