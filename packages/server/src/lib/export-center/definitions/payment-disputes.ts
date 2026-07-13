import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { paymentDisputes } from '../../../db/schema';
import { buildDisputesWhere, type ListDisputesQuery } from '../../../services/payment/payment-dispute.service';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_DISPUTE_STATUS_LABELS, PAYMENT_DISPUTE_TYPE_LABELS } from '@zenith/shared';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const EXPORT_LIMIT = 50000;

const columns: ExportColumn[] = [
  { key: 'disputeNo', header: '投诉单号', width: 22 },
  { key: 'channelDisputeNo', header: '渠道投诉号', width: 24 },
  { key: 'channel', header: '渠道', width: 10, enumMap: PAYMENT_CHANNEL_LABELS },
  { key: 'orderNo', header: '订单号', width: 22 },
  { key: 'complainant', header: '投诉人', width: 18 },
  { key: 'type', header: '类型', width: 12, enumMap: PAYMENT_DISPUTE_TYPE_LABELS },
  { key: 'amount', header: '涉诉金额(元)', width: 12, type: 'money' },
  { key: 'status', header: '状态', width: 10, enumMap: PAYMENT_DISPUTE_STATUS_LABELS },
  { key: 'refundNo', header: '退款单号', width: 22 },
  { key: 'deadline', header: '处理时效', width: 20, type: 'datetime' },
  { key: 'resolvedAt', header: '完结时间', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const paymentDisputesExportDefinition = defineExport<ListDisputesQuery & Record<string, unknown>, Record<string, unknown>>({
  entity: 'payment.disputes',
  moduleName: '交易投诉',
  filenamePrefix: '投诉工单',
  sourcePath: '/payment/disputes',
  sheetName: '投诉工单',
  permissions: { export: 'payment:dispute:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => Math.min(await db.$count(paymentDisputes, await buildDisputesWhere(query)), EXPORT_LIMIT),
  streamRows: async (query) =>
    db.select().from(paymentDisputes).where(await buildDisputesWhere(query)).orderBy(desc(paymentDisputes.id)).limit(EXPORT_LIMIT),
});
