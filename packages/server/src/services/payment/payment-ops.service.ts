import { paymentEventAttemptSchema, paymentOpsContract, paymentOutboxEventSchema } from '@zenith/shared/payment';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 支付运营排障 Service。
 * Outbox 事件查看与手动重投、模拟支付成功回调（演示/联调用），
 * 帮助运营快速排障与复现支付履约链路。
 */
import { and, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { listRows } from '../../lib/list-query';
import { appWebhookDeliveries, paymentEventAttempts, paymentEvents, paymentOrders, paymentReconCases, paymentSharingOrders, paymentTransfers, type PaymentEventAttemptRow, type PaymentEventRow } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { getTenantScopeId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { buildSandboxNotifyRequest } from '../../lib/payment/sandbox-notify';
import { interruptProcessingPaymentEventAttempts, processEvent } from './payment-outbox.service';
import { buildAdapterContext, handleNotify, mapOrder, loadOrderConfig } from './payment.service';
import type { PaymentEventAttempt, PaymentOrder, PaymentOutboxEvent } from '@zenith/shared/payment';
import { pickEntity } from '../../lib/entity-map';
import { getPaymentEventHealth } from './payment-events.service';

export function mapOutboxEvent(row: PaymentEventRow): PaymentOutboxEvent {
  return pickEntity(paymentOutboxEventSchema, row);
}

export function mapPaymentEventAttempt(row: PaymentEventAttemptRow): PaymentEventAttempt {
  return pickEntity(paymentEventAttemptSchema, row);
}

export interface PaymentHealth {
  outboxPending: number;
  outboxFailed: number;
  webhookPending: number;
  webhookFailed24h: number;
  sharingProcessing: number;
  transferProcessing: number;
  reconPendingDiff: number;
}

/** 支付链路运维健康指标：outbox 积压/死信、webhook 待投/24h 失败、处理中分账/转账、待处理对账差异。
 * orderNo 天然贯穿订单→事件→Webhook 投递，可作为排障 trace 键。 */
export async function getPaymentHealth(): Promise<PaymentHealth> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const user = currentUser();
  const sharingTenant = tenantCondition(paymentSharingOrders, user);
  const transferTenant = tenantCondition(paymentTransfers, user);
  const reconTenant = tenantCondition(paymentReconCases, user);
  const paymentWebhook = and(
    tenantCondition(appWebhookDeliveries, user),
    or(like(appWebhookDeliveries.eventType, 'payment.%'), like(appWebhookDeliveries.eventType, 'refund.%')),
  );
  const [eventHealth, webhookPending, webhookFailed24h, sharingProcessing, transferProcessing, reconPendingDiff] = await Promise.all([
    getPaymentEventHealth(getTenantScopeId(user)),
    db.$count(appWebhookDeliveries, and(paymentWebhook, inArray(appWebhookDeliveries.status, ['pending', 'retrying']))),
    db.$count(appWebhookDeliveries, and(paymentWebhook, eq(appWebhookDeliveries.status, 'failed'), gte(appWebhookDeliveries.finishedAt, since24h))),
    db.$count(paymentSharingOrders, buildWhere(eq(paymentSharingOrders.status, 'processing'), sharingTenant)),
    db.$count(paymentTransfers, buildWhere(inArray(paymentTransfers.status, ['processing', 'unknown']), transferTenant)),
    db.$count(paymentReconCases, buildWhere(inArray(paymentReconCases.status, ['open', 'investigating', 'suspended']), reconTenant)),
  ]);
  return { outboxPending: eventHealth.counts.pending, outboxFailed: eventHealth.counts.dead ?? 0, webhookPending, webhookFailed24h, sharingProcessing, transferProcessing, reconPendingDiff };
}

export async function listPaymentEvents(q: QueryOutputOf<typeof paymentOpsContract.events>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [paymentEvents.orderNo]),
    q.status ? eq(paymentEvents.status, q.status) : undefined,
    q.type ? eq(paymentEvents.type, q.type) : undefined,
    tenantCondition(paymentEvents, currentUser()),
  );
  return listRows({
    page,
    pageSize,
    table: paymentEvents,
    where,
    orderBy: [desc(paymentEvents.id)],
    map: mapOutboxEvent,
  });
}

export async function getPaymentEvent(id: number): Promise<PaymentOutboxEvent> {
  const tc = tenantCondition(paymentEvents, currentUser());
  const [row] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.id, id), tc)).limit(1);
  requireRow(row, '事件不存在');
  return mapOutboxEvent(row);
}

export async function listPaymentEventAttempts(id: number): Promise<PaymentEventAttempt[]> {
  await getPaymentEvent(id);
  const rows = await db.select().from(paymentEventAttempts)
    .where(eq(paymentEventAttempts.eventId, id))
    .orderBy(desc(paymentEventAttempts.generation), desc(paymentEventAttempts.attemptNo), desc(paymentEventAttempts.id));
  return rows.map(mapPaymentEventAttempt);
}

/** 手动重投 Outbox 事件：重置为 pending 并立即投递。 */
export async function redispatchEvent(id: number): Promise<PaymentOutboxEvent> {
  const tc = tenantCondition(paymentEvents, currentUser());
  const [row] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.id, id), tc)).limit(1);
  requireRow(row, '事件不存在');
  await db.transaction(async (tx) => {
    const redispatchedAt = new Date();
    await interruptProcessingPaymentEventAttempts(tx, id, redispatchedAt, '手动重投已结束上一轮未完成的尝试');
    await tx.update(paymentEvents).set({
      status: 'pending',
      attempts: 0,
      generation: sql`${paymentEvents.generation} + 1`,
      redispatchCount: sql`${paymentEvents.redispatchCount} + 1`,
      lastError: null,
      processedAt: null,
    }).where(and(eq(paymentEvents.id, id), tc));
  });
  await processEvent(id);
  return getPaymentEvent(id);
}

/**
 * 模拟支付成功（演示/联调）：构造沙箱回调报文送入 handleNotify，
 * 与真实渠道回调完全同径（验签 → 回调日志 → 幂等更新 → outbox 事件 → Webhook），
 * 回调解析层在沙箱环境同样可被验证。
 * 安全限制：仅沙箱渠道配置可通过沙箱回调协议验签；生产环境显式拒绝非沙箱订单。
 */
export async function simulateOrderPaid(id: number, ip = '127.0.0.1'): Promise<PaymentOrder> {
  const tc = tenantCondition(paymentOrders, currentUser());
  const [order] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, id), tc)).limit(1);
  requireRow(order, '支付订单不存在');
  if (order.status !== 'pending' && order.status !== 'paying') {
    throw new HTTPException(400, { message: '仅待支付/支付中订单可模拟支付' });
  }
  const config = await loadOrderConfig(order);
  if (!config?.sandbox) {
    if (process.env.NODE_ENV === 'production') {
      throw new HTTPException(403, { message: '生产环境仅允许对沙箱渠道订单模拟支付' });
    }
    throw new HTTPException(400, { message: '该订单渠道配置未开启沙箱模式，无法模拟支付（请启用沙箱配置）' });
  }
  const ctx = buildAdapterContext(config);
  const secret = ctx.secrets.sandboxNotifySecret;
  if (!secret) throw new HTTPException(400, { message: '沙箱回调密钥不可用，请重新创建沙箱商户配置' });
  const merchantId = order.channel === 'wechat'
    ? config.wechatMchId || `sandbox-merchant-${config.id}`
    : order.channel === 'alipay'
      ? config.alipaySellerId || `sandbox-merchant-${config.id}`
      : config.unionpayMerId || `sandbox-merchant-${config.id}`;
  const providerAppId = order.channel === 'wechat'
    ? config.wechatAppId || `sandbox-app-${config.id}`
    : order.channel === 'alipay'
      ? config.alipayAppId || `sandbox-app-${config.id}`
      : undefined;
  const { body, headers } = buildSandboxNotifyRequest({
    secret,
    channelConfigId: config.id,
    scene: 'payment',
    outTradeNo: order.outTradeNo,
    channelTradeNo: `SIM${Date.now()}`,
    tradeStatus: 'success',
    paidAmount: order.amount,
    currency: order.currency,
    merchantId,
    providerAppId,
    paidAt: formatDateTime(new Date()),
  });
  const { ack } = await handleNotify(order.channel, config.callbackToken, body, headers, ip);
  if (ack.status !== 200) {
    throw new HTTPException(400, { message: `模拟回调未被受理（HTTP ${ack.status}）：${ack.body.slice(0, 120)}` });
  }
  const [latest] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, id)).limit(1);
  return mapOrder(latest ?? order);
}
