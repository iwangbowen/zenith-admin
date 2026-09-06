import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { paymentRefunds } from '../../../db/schema';
import { buildRefundsWhere, type ListRefundsQuery } from '../../../services/payment/payment.service';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_REFUND_STATUS_LABELS } from '@zenith/shared/payment';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const EXPORT_LIMIT = 50000;

const columns: ExportColumn[] = [
  { key: 'refundNo', header: '退款单号', width: 22 },
  { key: 'orderNo', header: '原订单号', width: 22 },
  { key: 'channelRefundNo', header: '渠道退款号', width: 22 },
  { key: 'refundAmount', header: '退款金额(元)', width: 14, type: 'money' },
  { key: 'totalAmount', header: '原单金额(元)', width: 14, type: 'money' },
  { key: 'channel', header: '渠道', width: 10, enumMap: PAYMENT_CHANNEL_LABELS },
  { key: 'status', header: '状态', width: 10, enumMap: PAYMENT_REFUND_STATUS_LABELS },
  { key: 'reason', header: '退款原因', width: 24 },
  { key: 'refundedAt', header: '退款时间', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const paymentRefundsExportDefinition = defineExport<ListRefundsQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'payment.refunds',
  moduleName: '退款记录',
  filenamePrefix: '退款记录',
  sourcePath: '/payment/refunds',
  sheetName: '退款记录',
  permissions: { export: 'payment:refund:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => Math.min(await db.$count(paymentRefunds, buildRefundsWhere(query)), EXPORT_LIMIT),
  streamRows: async (query) =>
    db.select().from(paymentRefunds).where(buildRefundsWhere(query)).orderBy(desc(paymentRefunds.id)).limit(EXPORT_LIMIT),
});
