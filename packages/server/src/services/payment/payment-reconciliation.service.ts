/**
 * 支付对账 / 关单定时任务（供 pg-boss-scheduler 注册的 handler 调用）。
 */
import { and, inArray, lt } from 'drizzle-orm';
import { db } from '../../db';
import { paymentChannelConfigs, paymentOrders, paymentRefunds } from '../../db/schema';
import { closeExpiredOrderSafely, createOrderConfigResolver, retryUnsubmittedRefunds, syncOrderStatus, syncRefundStatus } from './payment.service';
import logger from '../../lib/logger';

/**
 * 单次运行处理的订单上限。每单都要外呼渠道查单，无上限扫描会让积压期的一次任务
 * 无限拉长（并占住数据库连接）。cron 周期重跑，余量会在后续批次继续消化。
 */
const RECONCILE_BATCH_SIZE = 500;

/** 关闭所有已超过 expiredAt 仍未支付的订单；渠道结果不确定时保持 unknown。 */
export async function closeExpiredOrders(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select()
    .from(paymentOrders)
    .where(and(inArray(paymentOrders.status, ['pending', 'paying', 'unknown']), lt(paymentOrders.expiredAt, now)))
    .orderBy(paymentOrders.id)
    .limit(RECONCILE_BATCH_SIZE);
  // 整批共用一个配置解析器：一批订单通常只落在少数几份渠道配置上，
  // 逐单查会把同一份配置反复取回（查单与关单各一次）
  const resolveConfig = createOrderConfigResolver();
  let count = 0;
  for (const order of rows) {
    try {
      if (await closeExpiredOrderSafely(order, resolveConfig)) count++;
    } catch (err) {
      logger.warn('[payment] close expired failed', { orderNo: order.orderNo, err: err instanceof Error ? err.message : 'unknown' });
    }
  }
  return count;
}

/** 对仍处于 paying/unknown 且创建超过 2 分钟的订单主动查单，纠正状态（回调兜底）。 */
export async function runReconciliation(): Promise<{ checked: number; fixed: number; refundChecked: number; refundFixed: number; refundRetried: number }> {
  const retriedRefunds = await retryUnsubmittedRefunds();
  const threshold = new Date(Date.now() - 2 * 60_000);
  const rows = await db
    .select()
    .from(paymentOrders)
    .where(and(inArray(paymentOrders.status, ['paying', 'unknown']), lt(paymentOrders.createdAt, threshold)))
    .orderBy(paymentOrders.id)
    .limit(RECONCILE_BATCH_SIZE);
  const resolveConfig = createOrderConfigResolver();
  let fixed = 0;
  for (const order of rows) {
    const updated = await syncOrderStatus(order, resolveConfig);
    if (updated.status !== order.status) fixed++;
  }

  const refunds = await db
    .select()
    .from(paymentRefunds)
    .where(and(inArray(paymentRefunds.status, ['processing', 'unknown']), lt(paymentRefunds.createdAt, threshold)))
    .orderBy(paymentRefunds.id)
    .limit(RECONCILE_BATCH_SIZE);
  const orderIds = [...new Set(refunds.map((refund) => refund.orderId).filter((id): id is number => id != null))];
  const refundOrders = orderIds.length > 0
    ? await db.select().from(paymentOrders).where(inArray(paymentOrders.id, orderIds))
    : [];
  const orderById = new Map(refundOrders.map((order) => [order.id, order]));
  const configIds = [...new Set(refundOrders.map((order) => order.channelConfigId))];
  const configs = configIds.length > 0
    ? await db.select().from(paymentChannelConfigs).where(inArray(paymentChannelConfigs.id, configIds))
    : [];
  const configById = new Map(configs.map((config) => [config.id, config]));
  let refundFixed = 0;
  for (const refund of refunds) {
    const order = refund.orderId != null ? orderById.get(refund.orderId) : undefined;
    const channelConfig = order ? configById.get(order.channelConfigId) : undefined;
    if (!order || !channelConfig) continue;
    try {
      const updated = await syncRefundStatus(refund, order, channelConfig);
      if (updated.status !== refund.status) refundFixed++;
    } catch (err) {
      logger.warn('[payment] refund reconciliation failed', {
        refundNo: refund.refundNo,
        err: err instanceof Error ? err.message : 'unknown',
      });
    }
  }
  return { checked: rows.length, fixed, refundChecked: refunds.length, refundFixed, refundRetried: retriedRefunds.submitted };
}
