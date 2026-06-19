/**
 * 支付统计与导出 Service。
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { paymentOrders, paymentRefunds } from '../db/schema';
import { currentUser } from '../lib/context';
import { tenantCondition } from '../lib/tenant';
import { mergeWhere } from '../lib/where-helpers';
import { APP_TIME_ZONE, formatDate } from '../lib/datetime';
import { streamToExcel, streamToCsv, formatDateTimeForExcel, type ExcelColumn } from '../lib/excel-export';
import {
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  PAYMENT_REFUND_STATUS_LABELS,
} from '@zenith/shared';
import type { PaymentChannel, PaymentMethod, PaymentOrderStatus, PaymentRefundStatus, PaymentStats, PaymentTrendPoint } from '@zenith/shared';
import { buildOrdersWhere, buildRefundsWhere, type ListOrdersQuery, type ListRefundsQuery } from './payment.service';

const EXPORT_LIMIT = 50000;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export async function getPaymentStats(): Promise<PaymentStats> {
  const user = currentUser();
  const tc = tenantCondition(paymentOrders, user);
  const rtc = tenantCondition(paymentRefunds, user);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const PAID_STATUSES = ['success', 'refunding', 'refunded'] as const;
  const [totals, todayRow, byStatusRows, byChannelRows, refundTotal] = await Promise.all([
    db
      .select({
        totalAmount: sql<number>`coalesce(sum(case when ${paymentOrders.status} in ('success','refunding','refunded') then ${paymentOrders.amount} else 0 end),0)`,
        orderCount: sql<number>`count(*)`,
        successCount: sql<number>`count(*) filter (where ${paymentOrders.status} in ('success','refunding','refunded'))`,
      })
      .from(paymentOrders)
      .where(tc),
    db
      .select({
        amount: sql<number>`coalesce(sum(${paymentOrders.amount}),0)`,
        count: sql<number>`count(*)`,
      })
      .from(paymentOrders)
      .where(mergeWhere(and(inArray(paymentOrders.status, [...PAID_STATUSES]), gte(paymentOrders.paidAt, todayStart)), tc)),
    db.select({ status: paymentOrders.status, count: sql<number>`count(*)` }).from(paymentOrders).where(tc).groupBy(paymentOrders.status),
    db
      .select({
        channel: paymentOrders.channel,
        count: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(case when ${paymentOrders.status} in ('success','refunding','refunded') then ${paymentOrders.amount} else 0 end),0)`,
      })
      .from(paymentOrders)
      .where(tc)
      .groupBy(paymentOrders.channel),
    db
      .select({
        amount: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)`,
        count: sql<number>`count(*)`,
      })
      .from(paymentRefunds)
      .where(mergeWhere(eq(paymentRefunds.status, 'success'), rtc)),
  ]);

  const totalAmount = Number(totals[0]?.totalAmount ?? 0);
  const orderCount = Number(totals[0]?.orderCount ?? 0);
  const successCount = Number(totals[0]?.successCount ?? 0);
  const refundAmount = Number(refundTotal[0]?.amount ?? 0);

  return {
    totalAmount,
    todayAmount: Number(todayRow[0]?.amount ?? 0),
    todayCount: Number(todayRow[0]?.count ?? 0),
    orderCount,
    successCount,
    refundAmount,
    refundCount: Number(refundTotal[0]?.count ?? 0),
    successRate: orderCount > 0 ? round1((successCount / orderCount) * 100) : 0,
    refundRate: totalAmount > 0 ? round1((refundAmount / totalAmount) * 100) : 0,
    avgAmount: successCount > 0 ? Math.round(totalAmount / successCount) : 0,
    byChannel: byChannelRows.map((r) => ({ channel: r.channel, count: Number(r.count), amount: Number(r.amount) })),
    byStatus: byStatusRows.map((r) => ({ status: r.status, count: Number(r.count) })),
  };
}

/** 收款趋势（近 N 天，按天聚合成功金额/笔数/退款金额，缺口补 0） */
export async function getPaymentTrend(days = 30): Promise<PaymentTrendPoint[]> {
  const user = currentUser();
  const tc = tenantCondition(paymentOrders, user);
  const rtc = tenantCondition(paymentRefunds, user);
  const safeDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);

  // 覆盖下界：多回溯 1 天，避免时区边界漏数据（多余日期不在序列内会被忽略）
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - safeDays);

  const PAID_STATUSES = ['success', 'refunding', 'refunded'] as const;
  const orderDay = sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${paymentOrders.paidAt}), 'YYYY-MM-DD')`;
  const refundDay = sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${paymentRefunds.refundedAt}), 'YYYY-MM-DD')`;

  const [orderRows, refundRows] = await Promise.all([
    db
      .select({ date: orderDay, amount: sql<number>`coalesce(sum(${paymentOrders.amount}),0)`, count: sql<number>`count(*)` })
      .from(paymentOrders)
      .where(mergeWhere(and(inArray(paymentOrders.status, [...PAID_STATUSES]), gte(paymentOrders.paidAt, start)), tc))
      .groupBy(sql`1`),
    db
      .select({ date: refundDay, amount: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)` })
      .from(paymentRefunds)
      .where(mergeWhere(and(eq(paymentRefunds.status, 'success'), gte(paymentRefunds.refundedAt, start)), rtc))
      .groupBy(sql`1`),
  ]);

  const orderMap = new Map(orderRows.map((r) => [r.date, { amount: Number(r.amount), count: Number(r.count) }]));
  const refundMap = new Map(refundRows.map((r) => [r.date, Number(r.amount)]));

  const result: PaymentTrendPoint[] = [];
  const dayMs = 86_400_000;
  const firstDay = Date.now() - (safeDays - 1) * dayMs;
  for (let i = 0; i < safeDays; i++) {
    const key = formatDate(new Date(firstDay + i * dayMs));
    const o = orderMap.get(key);
    result.push({ date: key, amount: o?.amount ?? 0, count: o?.count ?? 0, refundAmount: refundMap.get(key) ?? 0 });
  }
  return result;
}

const yuan = (v: unknown): string => ((Number(v) || 0) / 100).toFixed(2);

const ORDER_COLUMNS: ExcelColumn[] = [
  { key: 'orderNo', header: '订单号', width: 22 },
  { key: 'outTradeNo', header: '商户单号', width: 22 },
  { key: 'channelTradeNo', header: '渠道交易号', width: 24, transform: (v) => (v as string) ?? '' },
  { key: 'subject', header: '标题', width: 24 },
  { key: 'amount', header: '金额(元)', width: 12, transform: yuan },
  { key: 'channel', header: '渠道', width: 10, transform: (v) => PAYMENT_CHANNEL_LABELS[v as PaymentChannel] ?? String(v ?? '') },
  { key: 'payMethod', header: '支付方式', width: 14, transform: (v) => PAYMENT_METHOD_LABELS[v as PaymentMethod] ?? String(v ?? '') },
  { key: 'status', header: '状态', width: 10, transform: (v) => PAYMENT_ORDER_STATUS_LABELS[v as PaymentOrderStatus] ?? String(v ?? '') },
  { key: 'bizType', header: '业务类型', width: 14 },
  { key: 'bizId', header: '业务ID', width: 14 },
  { key: 'paidAt', header: '支付时间', width: 20, transform: (v) => formatDateTimeForExcel(v as Date | null) },
  { key: 'createdAt', header: '创建时间', width: 20, transform: (v) => formatDateTimeForExcel(v as Date) },
];

const REFUND_COLUMNS: ExcelColumn[] = [
  { key: 'refundNo', header: '退款单号', width: 22 },
  { key: 'orderNo', header: '原订单号', width: 22 },
  { key: 'channelRefundNo', header: '渠道退款号', width: 22, transform: (v) => (v as string) ?? '' },
  { key: 'refundAmount', header: '退款金额(元)', width: 14, transform: yuan },
  { key: 'totalAmount', header: '原单金额(元)', width: 14, transform: yuan },
  { key: 'channel', header: '渠道', width: 10, transform: (v) => PAYMENT_CHANNEL_LABELS[v as PaymentChannel] ?? String(v ?? '') },
  { key: 'status', header: '状态', width: 10, transform: (v) => PAYMENT_REFUND_STATUS_LABELS[v as PaymentRefundStatus] ?? String(v ?? '') },
  { key: 'reason', header: '退款原因', width: 24, transform: (v) => (v as string) ?? '' },
  { key: 'refundedAt', header: '退款时间', width: 20, transform: (v) => formatDateTimeForExcel(v as Date | null) },
  { key: 'createdAt', header: '创建时间', width: 20, transform: (v) => formatDateTimeForExcel(v as Date) },
];

export async function exportOrders(q: ListOrdersQuery): Promise<ReadableStream> {
  const where = await buildOrdersWhere(q);
  const rows = await db.select().from(paymentOrders).where(where).orderBy(desc(paymentOrders.id)).limit(EXPORT_LIMIT);
  return streamToExcel(ORDER_COLUMNS, rows as unknown as Record<string, unknown>[], '支付订单');
}

export async function exportOrdersCsv(q: ListOrdersQuery): Promise<ReadableStream> {
  const where = await buildOrdersWhere(q);
  const rows = await db.select().from(paymentOrders).where(where).orderBy(desc(paymentOrders.id)).limit(EXPORT_LIMIT);
  return streamToCsv(ORDER_COLUMNS, rows as unknown as Record<string, unknown>[]);
}

export async function exportRefunds(q: ListRefundsQuery): Promise<ReadableStream> {
  const where = buildRefundsWhere(q);
  const rows = await db.select().from(paymentRefunds).where(where).orderBy(desc(paymentRefunds.id)).limit(EXPORT_LIMIT);
  return streamToExcel(REFUND_COLUMNS, rows as unknown as Record<string, unknown>[], '退款记录');
}

export async function exportRefundsCsv(q: ListRefundsQuery): Promise<ReadableStream> {
  const where = buildRefundsWhere(q);
  const rows = await db.select().from(paymentRefunds).where(where).orderBy(desc(paymentRefunds.id)).limit(EXPORT_LIMIT);
  return streamToCsv(REFUND_COLUMNS, rows as unknown as Record<string, unknown>[]);
}
