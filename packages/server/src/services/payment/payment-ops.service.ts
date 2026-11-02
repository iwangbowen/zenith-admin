import { paymentEventAttemptSchema, paymentOpsContract, paymentOutboxEventSchema } from '@zenith/shared/payment';
import type { QueryOutputOf } from '@zenith/shared/core';
import { and, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { eventConsumerAttempts, eventConsumerDeliveries, eventOutbox, appWebhookDeliveries, paymentOrders, paymentReconCases, paymentSharingOrders, paymentTransfers } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { getTenantScopeId, optionalExactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { buildSandboxNotifyRequest } from '../../lib/payment/sandbox-notify';
import { buildAdapterContext, handleNotify, mapOrder, loadOrderConfig } from './payment.service';
import type { PaymentEventAttempt, PaymentOrder, PaymentOutboxEvent } from '@zenith/shared/payment';
import { getPaymentEventHealth } from './payment-events.service';
import { retryEventConsumer, wakeEventConsumers } from '../../lib/domain-events';
import { buildListResult } from '../../lib/list-query';

function paymentDeliveryScope(tenantId: number | null | undefined) {
  return buildWhere(eq(eventOutbox.domain, 'payment'), optionalExactTenantCondition(eventOutbox.tenantId, tenantId));
}

function mapOutboxEvent(row: {
  delivery: typeof eventConsumerDeliveries.$inferSelect;
  event: typeof eventOutbox.$inferSelect;
}): PaymentOutboxEvent {
  const payload = row.event.payload;
  return paymentOutboxEventSchema.parse({
    id: row.delivery.id, eventId: row.event.eventId, type: row.event.eventType,
    orderNo: typeof payload.orderNo === 'string' ? payload.orderNo : row.event.businessKey,
    consumerKey: row.delivery.consumerKey, status: row.delivery.status, attempts: row.delivery.attempts,
    maxAttempts: row.delivery.maxAttempts, generation: row.delivery.generation, payload,
    result: row.delivery.result ?? null, lastError: row.delivery.lastError ?? null,
    createdAt: formatDateTime(row.event.occurredAt), runAt: formatDateTime(row.delivery.runAt),
    finishedAt: formatNullableDateTime(row.delivery.finishedAt),
  });
}

function mapPaymentEventAttempt(row: typeof eventConsumerAttempts.$inferSelect): PaymentEventAttempt {
  return paymentEventAttemptSchema.parse({ id: row.id, eventId: row.deliveryId, generation: row.generation,
    attemptNo: row.attempt, status: row.status, errorMessage: row.error ?? null,
    startedAt: formatDateTime(row.startedAt), finishedAt: formatNullableDateTime(row.finishedAt) });
}

export interface PaymentHealth { outboxPending: number; outboxFailed: number; webhookPending: number; webhookFailed24h: number;
  sharingProcessing: number; transferProcessing: number; reconPendingDiff: number }

export async function getPaymentHealth(): Promise<PaymentHealth> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const user = currentUser();
  const sharingTenant = tenantCondition(paymentSharingOrders, user);
  const transferTenant = tenantCondition(paymentTransfers, user);
  const reconTenant = tenantCondition(paymentReconCases, user);
  const paymentWebhook = and(tenantCondition(appWebhookDeliveries, user), or(like(appWebhookDeliveries.eventType, 'payment.%'), like(appWebhookDeliveries.eventType, 'refund.%')));
  const [eventHealth, webhookPending, webhookFailed24h, sharingProcessing, transferProcessing, reconPendingDiff] = await Promise.all([
    getPaymentEventHealth(getTenantScopeId(user)),
    db.$count(appWebhookDeliveries, and(paymentWebhook, inArray(appWebhookDeliveries.status, ['pending', 'retrying']))),
    db.$count(appWebhookDeliveries, and(paymentWebhook, eq(appWebhookDeliveries.status, 'failed'), gte(appWebhookDeliveries.finishedAt, since24h))),
    db.$count(paymentSharingOrders, buildWhere(eq(paymentSharingOrders.status, 'processing'), sharingTenant)),
    db.$count(paymentTransfers, buildWhere(inArray(paymentTransfers.status, ['processing', 'unknown']), transferTenant)),
    db.$count(paymentReconCases, buildWhere(inArray(paymentReconCases.status, ['open', 'investigating', 'suspended']), reconTenant)),
  ]);
  return { outboxPending: eventHealth.counts.pending + eventHealth.counts.running, outboxFailed: eventHealth.counts.dead ?? 0,
    webhookPending, webhookFailed24h, sharingProcessing, transferProcessing, reconPendingDiff };
}

export async function listPaymentEvents(q: QueryOutputOf<typeof paymentOpsContract.events>) {
  const { page, pageSize } = q;
  const scope = paymentDeliveryScope(getTenantScopeId(currentUser()));
  const where = buildWhere(scope, q.status ? eq(eventConsumerDeliveries.status, q.status) : undefined,
    keywordCondition(q.type, [eventOutbox.eventType], 'ilike'),
    keywordCondition(q.keyword, [sql`${eventOutbox.payload}->>'orderNo'`, eventConsumerDeliveries.consumerKey], 'ilike'));
  return buildListResult({ page, pageSize,
    count: async () => Number((await db.select({ count: sql<number>`count(*)::int` }).from(eventConsumerDeliveries)
      .innerJoin(eventOutbox, eq(eventOutbox.id, eventConsumerDeliveries.eventId)).where(where))[0]?.count ?? 0),
    rows: () => withPagination(db.select({ delivery: eventConsumerDeliveries, event: eventOutbox })
      .from(eventConsumerDeliveries).innerJoin(eventOutbox, eq(eventOutbox.id, eventConsumerDeliveries.eventId))
      .where(where).orderBy(desc(eventConsumerDeliveries.id)).$dynamic(), page, pageSize),
    map: mapOutboxEvent,
  });
}

export async function getPaymentEvent(id: number): Promise<PaymentOutboxEvent> {
  const [row] = await db.select({ delivery: eventConsumerDeliveries, event: eventOutbox }).from(eventConsumerDeliveries)
    .innerJoin(eventOutbox, eq(eventOutbox.id, eventConsumerDeliveries.eventId))
    .where(and(eq(eventConsumerDeliveries.id, id), paymentDeliveryScope(getTenantScopeId(currentUser())))).limit(1);
  return mapOutboxEvent(requireRow(row, '支付事件消费者不存在'));
}

export async function listPaymentEventAttempts(id: number): Promise<PaymentEventAttempt[]> {
  await getPaymentEvent(id);
  const rows = await db.select().from(eventConsumerAttempts).where(eq(eventConsumerAttempts.deliveryId, id))
    .orderBy(desc(eventConsumerAttempts.generation), desc(eventConsumerAttempts.attempt), desc(eventConsumerAttempts.id));
  return rows.map(mapPaymentEventAttempt);
}

export async function redispatchEvent(id: number): Promise<PaymentOutboxEvent> {
  await getPaymentEvent(id);
  if (!await retryEventConsumer(id)) throw new HTTPException(409, { message: '仅死信或等待重试的消费者可以重试' });
  await wakeEventConsumers();
  return getPaymentEvent(id);
}

export async function simulateOrderPaid(id: number, ip = '127.0.0.1'): Promise<PaymentOrder> {
  const tc = tenantCondition(paymentOrders, currentUser());
  const [order] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.id, id), tc)).limit(1);
  requireRow(order, '支付订单不存在');
  if (order.status !== 'pending' && order.status !== 'paying') throw new HTTPException(400, { message: '仅待支付/支付中订单可模拟支付' });
  const config = await loadOrderConfig(order);
  if (!config?.sandbox) {
    if (process.env.NODE_ENV === 'production') throw new HTTPException(403, { message: '生产环境仅允许对沙箱渠道订单模拟支付' });
    throw new HTTPException(400, { message: '该订单渠道配置未开启沙箱模式，无法模拟支付（请启用沙箱配置）' });
  }
  const ctx = buildAdapterContext(config); const secret = ctx.secrets.sandboxNotifySecret;
  if (!secret) throw new HTTPException(400, { message: '沙箱回调密钥不可用，请重新创建沙箱商户配置' });
  const merchantId = order.channel === 'wechat' ? config.wechatMchId || `sandbox-merchant-${config.id}`
    : order.channel === 'alipay' ? config.alipaySellerId || `sandbox-merchant-${config.id}` : config.unionpayMerId || `sandbox-merchant-${config.id}`;
  const providerAppId = order.channel === 'wechat' ? config.wechatAppId || `sandbox-app-${config.id}`
    : order.channel === 'alipay' ? config.alipayAppId || `sandbox-app-${config.id}` : undefined;
  const { body, headers } = buildSandboxNotifyRequest({ secret, channelConfigId: config.id, scene: 'payment', outTradeNo: order.outTradeNo,
    channelTradeNo: `SIM${Date.now()}`, tradeStatus: 'success', paidAmount: order.amount, currency: order.currency,
    merchantId, providerAppId, paidAt: formatDateTime(new Date()) });
  const { ack } = await handleNotify(order.channel, config.callbackToken, body, headers, ip);
  if (ack.status !== 200) throw new HTTPException(400, { message: `模拟回调未被受理（HTTP ${ack.status}）：${ack.body.slice(0, 120)}` });
  const [latest] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, id)).limit(1);
  return mapOrder(latest ?? order);
}
