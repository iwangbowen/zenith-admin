/**
 * 支付统计与导出 Service。
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { paymentOrders, paymentRefunds } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { APP_TIME_ZONE, formatDate, startOfDayAgo, startOfToday } from '../../lib/datetime';
import type { PaymentStats, PaymentTrendPoint } from '@zenith/shared/payment';

const round1 = (n: number): number => Math.round(n * 10) / 10;

export async function getPaymentStats(): Promise<PaymentStats> {
  const user = currentUser();
  const tc = tenantCondition(paymentOrders, user);
  const rtc = tenantCondition(paymentRefunds, user);
  const todayStart = startOfToday();

  const PAID_STATUSES = ['success', 'refunding', 'refunded'] as const;
  const paidAmountExpr = sql<number>`coalesce(sum(case when ${paymentOrders.status} in ('success','refunding','refunded') then ${paymentOrders.amount} else 0 end),0)`;
  const [totals, todayRow, byStatusRows, byChannelRows, byPayMethodRows, byBizTypeRows, refundTotal] = await Promise.all([
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
      .where(buildWhere(and(inArray(paymentOrders.status, [...PAID_STATUSES]), gte(paymentOrders.paidAt, todayStart)), tc)),
    db.select({ status: paymentOrders.status, count: sql<number>`count(*)` }).from(paymentOrders).where(tc).groupBy(paymentOrders.status),
    db
      .select({
        channel: paymentOrders.channel,
        count: sql<number>`count(*)`,
        amount: paidAmountExpr,
      })
      .from(paymentOrders)
      .where(tc)
      .groupBy(paymentOrders.channel),
    db
      .select({
        payMethod: paymentOrders.payMethod,
        count: sql<number>`count(*)`,
        amount: paidAmountExpr,
      })
      .from(paymentOrders)
      .where(tc)
      .groupBy(paymentOrders.payMethod),
    db
      .select({
        bizType: paymentOrders.bizType,
        count: sql<number>`count(*) filter (where ${paymentOrders.status} in ('success','refunding','refunded'))`,
        amount: paidAmountExpr,
      })
      .from(paymentOrders)
      .where(tc)
      .groupBy(paymentOrders.bizType)
      .orderBy(sql`3 desc`)
      .limit(10),
    db
      .select({
        amount: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)`,
        count: sql<number>`count(*)`,
      })
      .from(paymentRefunds)
      .where(buildWhere(eq(paymentRefunds.status, 'success'), rtc)),
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
    byPayMethod: byPayMethodRows.map((r) => ({ payMethod: r.payMethod, count: Number(r.count), amount: Number(r.amount) })),
    byBizType: byBizTypeRows.map((r) => ({ bizType: r.bizType, count: Number(r.count), amount: Number(r.amount) })),
  };
}

/** 收款趋势（近 N 天，按天聚合成功金额/笔数/退款金额，缺口补 0） */
export async function getPaymentTrend(days = 30): Promise<PaymentTrendPoint[]> {
  const user = currentUser();
  const tc = tenantCondition(paymentOrders, user);
  const rtc = tenantCondition(paymentRefunds, user);
  const safeDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);

  // 覆盖下界：多回溯 1 天，避免时区边界漏数据（多余日期不在序列内会被忽略）
  const start = startOfDayAgo(safeDays);

  const PAID_STATUSES = ['success', 'refunding', 'refunded'] as const;
  const orderDay = sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${paymentOrders.paidAt}), 'YYYY-MM-DD')`;
  const refundDay = sql<string>`to_char(timezone(${APP_TIME_ZONE}, ${paymentRefunds.refundedAt}), 'YYYY-MM-DD')`;

  const [orderRows, refundRows] = await Promise.all([
    db
      .select({ date: orderDay, amount: sql<number>`coalesce(sum(${paymentOrders.amount}),0)`, count: sql<number>`count(*)` })
      .from(paymentOrders)
      .where(buildWhere(and(inArray(paymentOrders.status, [...PAID_STATUSES]), gte(paymentOrders.paidAt, start)), tc))
      .groupBy(sql`1`),
    db
      .select({ date: refundDay, amount: sql<number>`coalesce(sum(${paymentRefunds.refundAmount}),0)` })
      .from(paymentRefunds)
      .where(buildWhere(and(eq(paymentRefunds.status, 'success'), gte(paymentRefunds.refundedAt, start)), rtc))
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
