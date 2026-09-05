import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_OUTBOX_EVENT_STATUSES } from '../constants';
import { paymentOrderSchema } from './payment-orders';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentOutboxEventSchema = z.object({
  id: z.int(),
  type: z.string(),
  orderNo: z.string(),
  status: z.enum(PAYMENT_OUTBOX_EVENT_STATUSES),
  attempts: z.int(),
  payload: z.string().nullable().optional().meta({ description: '事件载荷 JSON（投递给订阅者 / Webhook 的内容），运营排障用' }),
  lastError: z.string().nullable().optional(),
  createdAt: z.string(),
  processedAt: z.string().nullable().optional(),
}).meta({ id: 'PaymentOutboxEvent' });

export type PaymentOutboxEvent = z.infer<typeof paymentOutboxEventSchema>;

/** 支付链路健康指标：outbox 积压 / 死信、webhook 待投 / 24h 失败、处理中分账 / 转账、待处理对账差异 */
export const paymentOpsHealthSchema = z.object({
  outboxPending: z.int(),
  outboxFailed: z.int(),
  webhookPending: z.int(),
  webhookFailed24h: z.int(),
  sharingProcessing: z.int(),
  transferProcessing: z.int(),
  reconPendingDiff: z.int(),
}).meta({ id: 'PaymentOpsHealth' });

export type PaymentOpsHealth = z.infer<typeof paymentOpsHealthSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentOutboxEventListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(PAYMENT_OUTBOX_EVENT_STATUSES).optional(),
  type: z.string().optional(),
});

export const paymentOpsContract = defineContract('/api/payment/ops', {
  events: op.get('/events', { query: paymentOutboxEventListQuery, response: paginated(paymentOutboxEventSchema), summary: '支付事件(Outbox)列表' }),
  health: op.get('/health', {
    response: paymentOpsHealthSchema,
    summary: '支付链路健康指标',
    description: 'Outbox 积压/死信、Webhook 待投递/24h 失败、处理中分账/转账、待处理对账差异，用于运维监控与告警。',
  }),
  redispatchEvent: op.post('/events/{id}/redispatch', { params: idParam, response: paymentOutboxEventSchema, summary: '手动重投支付事件' }),
  simulateOrderPaid: op.post('/orders/{id}/simulate-paid', {
    params: idParam,
    response: paymentOrderSchema,
    summary: '模拟支付成功（演示/联调）',
    description: '构造沙箱回调报文送入 handleNotify，与真实渠道回调完全同径（验签/回调日志/幂等/事件/Webhook）。仅沙箱渠道配置可用。',
  }),
}, { tags: ['支付中心-运营'] });
