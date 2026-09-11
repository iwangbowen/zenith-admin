import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { paymentOrders } from '../../../db/schema';
import { buildOrdersWhere, type PaymentOrderListFilter } from '../../../services/payment/payment.service';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared/payment';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const EXPORT_LIMIT = 50000;

const columns: ExportColumn[] = [
  { key: 'orderNo', header: '订单号', width: 22 },
  { key: 'outTradeNo', header: '商户单号', width: 22 },
  { key: 'channelTradeNo', header: '渠道交易号', width: 24 },
  { key: 'subject', header: '标题', width: 24 },
  { key: 'amount', header: '金额(元)', width: 12, type: 'money' },
  { key: 'channel', header: '渠道', width: 10, enumMap: PAYMENT_CHANNEL_LABELS },
  { key: 'payMethod', header: '支付方式', width: 14, enumMap: PAYMENT_METHOD_LABELS },
  { key: 'status', header: '状态', width: 10, enumMap: PAYMENT_ORDER_STATUS_LABELS },
  { key: 'bizType', header: '业务类型', width: 14 },
  { key: 'bizId', header: '业务ID', width: 14 },
  { key: 'paidAt', header: '支付时间', width: 20, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 20, type: 'datetime' },
];

export const paymentOrdersExportDefinition = defineExport<PaymentOrderListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'payment.orders',
  moduleName: '支付订单',
  filenamePrefix: '支付订单',
  sourcePath: '/payment/orders',
  sheetName: '支付订单',
  permissions: { export: 'payment:order:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => Math.min(await db.$count(paymentOrders, await buildOrdersWhere(query)), EXPORT_LIMIT),
  streamRows: async (query) =>
    db.select().from(paymentOrders).where(await buildOrdersWhere(query)).orderBy(desc(paymentOrders.id)).limit(EXPORT_LIMIT),
});
