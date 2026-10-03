/**
 * 支付域告警指标源：供监控告警评估器（monitor-alert）实时采集的派生指标。
 *
 * 全部为轻量计数 / 比率查询，随评估周期（默认 30 秒）执行，因此只走带索引的状态列 + 时间窗口，
 * 不做任何跨表大范围扫描。指标口径与阈值含义见 `@zenith/shared/platform` 的 MONITOR_METRIC_META。
 */
import { and, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
import { db } from '../../db';
import {
  appWebhookDeliveries,
  oauth2Clients,
  paymentApps,
  paymentOrders,
  paymentReconCases,
} from '../../db/schema';
import { buildWhere } from '../../lib/where-helpers';
import { metricTenantFilter, ratePercent } from '../../lib/alert-metrics';
import { getPaymentEventHealth } from './payment-events.service';

/** 比率型指标的统计窗口 */
const RECENT_WINDOW_MS = 60 * 60_000;

/** 进入「支付中」后多久没有终态就算卡单 */
const STUCK_PAYING_GRACE_MS = 30 * 60_000;

export interface PaymentAlertMetrics {
  /** 近 60 分钟支付失败率（%） */
  paymentFailureRate: number;
  /** 支付中超过宽限期未拿到终态的订单数 */
  paymentStuckPaying: number;
  /** 对账差异中仍待人工处理的条目数 */
  paymentReconDiff: number;
  /** 未成功派发的支付事件数 */
  paymentEventBacklog: number;
  /** 近 60 分钟商户 Webhook 投递失败率（%） */
  paymentWebhookFailureRate: number;
}

/**
 * 采集支付域告警指标。`tenantId` 为空表示平台级统计（全租户汇总）。
 *
 * 失败率的分母只取「成功 + 失败」：`closed`（超时未支付自动关单）是用户放弃，
 * 计入分母会让失败率随下单量波动而失真，掩盖真正的渠道故障。
 */
export async function getPaymentAlertMetrics(tenantId: number | null): Promise<PaymentAlertMetrics> {
  const now = Date.now();
  const recentCutoff = new Date(now - RECENT_WINDOW_MS);
  const stuckCutoff = new Date(now - STUCK_PAYING_GRACE_MS);

  const orderTenant = metricTenantFilter(paymentOrders.tenantId, tenantId);
  const paymentClientIds = db
    .select({ clientId: oauth2Clients.clientId })
    .from(paymentApps)
    .innerJoin(oauth2Clients, eq(oauth2Clients.id, paymentApps.openClientId))
    .where(metricTenantFilter(paymentApps.tenantId, tenantId));
  const paymentWebhook = and(
    inArray(appWebhookDeliveries.clientId, paymentClientIds),
    or(like(appWebhookDeliveries.eventType, 'payment.%'), like(appWebhookDeliveries.eventType, 'refund.%')),
  );
  const reconTenant = metricTenantFilter(paymentReconCases.tenantId, tenantId);

  const [
    paidCount, failedCount, stuckPaying, reconDiff,
    eventHealth, webhookSuccess, webhookFailed,
  ] = await Promise.all([
    db.$count(paymentOrders, buildWhere(eq(paymentOrders.status, 'success'), gte(paymentOrders.updatedAt, recentCutoff), orderTenant)),
    db.$count(paymentOrders, buildWhere(eq(paymentOrders.status, 'failed'), gte(paymentOrders.updatedAt, recentCutoff), orderTenant)),
    db.$count(paymentOrders, buildWhere(eq(paymentOrders.status, 'paying'), lte(paymentOrders.updatedAt, stuckCutoff), orderTenant)),
    db.$count(paymentReconCases, buildWhere(inArray(paymentReconCases.status, ['open', 'investigating', 'suspended']), reconTenant)),
    getPaymentEventHealth(tenantId ?? undefined),
    db.$count(appWebhookDeliveries, buildWhere(eq(appWebhookDeliveries.status, 'success'), gte(appWebhookDeliveries.createdAt, recentCutoff), paymentWebhook)),
    db.$count(appWebhookDeliveries, buildWhere(eq(appWebhookDeliveries.status, 'failed'), gte(appWebhookDeliveries.createdAt, recentCutoff), paymentWebhook)),
  ]);

  return {
    paymentFailureRate: ratePercent(failedCount, paidCount + failedCount),
    paymentStuckPaying: stuckPaying,
    paymentReconDiff: reconDiff,
    paymentEventBacklog: eventHealth.counts.stuck + (eventHealth.counts.dead ?? 0),
    paymentWebhookFailureRate: ratePercent(webhookFailed, webhookSuccess + webhookFailed),
  };
}
