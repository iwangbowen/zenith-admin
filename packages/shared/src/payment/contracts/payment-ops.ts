import * as z from 'zod';
import { dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CHANNELS,
  PAYMENT_EVENT_ATTEMPT_STATUSES,
  PAYMENT_EXCEPTION_STATUSES,
  PAYMENT_EXCEPTION_STATUS_OPTIONS,
  PAYMENT_EXCEPTION_TYPES,
  PAYMENT_EXCEPTION_TYPE_OPTIONS,
  PAYMENT_OUTBOX_EVENT_STATUSES,
  PAYMENT_OUTBOX_EVENT_STATUS_OPTIONS,
} from '../constants';
import { paymentOrderSchema } from './payment-orders';

export const paymentOutboxEventSchema = z.object({
  id: z.int(),
  eventId: z.string(),
  type: z.string(),
  orderNo: z.string(),
  consumerKey: z.string(),
  status: z.enum(PAYMENT_OUTBOX_EVENT_STATUSES),
  attempts: z.int().nonnegative(),
  maxAttempts: z.int().positive(),
  generation: z.int().nonnegative(),
  payload: z.record(z.string(), z.unknown()).meta({ description: '不可变支付事件快照' }),
  result: z.record(z.string(), z.unknown()).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  runAt: z.string(),
  finishedAt: z.string().nullable(),
}).meta({ id: 'PaymentOutboxEvent' });

export type PaymentOutboxEvent = z.infer<typeof paymentOutboxEventSchema>;

export const paymentEventAttemptSchema = z.object({
  id: z.int(),
  eventId: z.int(),
  generation: z.int().nonnegative(),
  attemptNo: z.int().positive(),
  status: z.enum(PAYMENT_EVENT_ATTEMPT_STATUSES),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
}).meta({ id: 'PaymentEventAttempt' });

export type PaymentEventAttempt = z.infer<typeof paymentEventAttemptSchema>;

export const paymentOpsHealthSchema = z.object({
  outboxPending: z.int(), outboxFailed: z.int(), webhookPending: z.int(), webhookFailed24h: z.int(),
  sharingProcessing: z.int(), transferProcessing: z.int(), reconPendingDiff: z.int(),
  paymentExceptionsOpen: z.int(),
}).meta({ id: 'PaymentOpsHealth' });

export type PaymentOpsHealth = z.infer<typeof paymentOpsHealthSchema>;

export const paymentExceptionSchema = z.object({
  id: z.int(),
  type: z.enum(PAYMENT_EXCEPTION_TYPES),
  dedupeKey: z.string().optional(),
  orderNo: z.string().nullable().optional(),
  refundNo: z.string().nullable().optional(),
  channel: z.enum(PAYMENT_CHANNELS).nullable().optional(),
  channelConfigId: z.int().nullable().optional(),
  appId: z.int().nullable().optional(),
  amount: z.int().nullable().optional(),
  currency: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(PAYMENT_EXCEPTION_STATUSES),
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: z.int().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'PaymentException' });

export type PaymentException = z.infer<typeof paymentExceptionSchema>;

export const paymentExceptionListQuery = paginationQuery.extend({
  keyword: keywordQuery('订单号 / 退款单号 / 错误信息'),
  status: queryEnum(PAYMENT_EXCEPTION_STATUSES, { options: PAYMENT_EXCEPTION_STATUS_OPTIONS }),
  type: queryEnum(PAYMENT_EXCEPTION_TYPES, { options: PAYMENT_EXCEPTION_TYPE_OPTIONS }),
  ...dateRangeQuery(),
});

export const paymentOutboxEventListQuery = paginationQuery.extend({
  keyword: keywordQuery('订单号 / 消费者'),
  status: queryEnum(PAYMENT_OUTBOX_EVENT_STATUSES, { description: '消费者状态', options: PAYMENT_OUTBOX_EVENT_STATUS_OPTIONS }),
  type: keywordQuery('事件类型'),
});

export const paymentOpsContract = defineContract('/api/payment/ops', {
  events: op.get('/events', { access: { permission: 'payment:ops:view' }, query: paymentOutboxEventListQuery, response: paginated(paymentOutboxEventSchema), summary: '支付领域事件消费者列表' }),
  eventAttempts: op.get('/events/{id}/attempts', { access: { permission: 'payment:ops:view' }, params: idParam, response: z.array(paymentEventAttemptSchema), summary: '支付事件消费者尝试历史' }),
  health: op.get('/health', { access: { permission: 'payment:ops:view' }, response: paymentOpsHealthSchema, summary: '支付链路健康指标',
    description: '领域事件消费者积压/死信、Webhook 待投递/24h 失败、处理中分账/转账、待处理对账差异。' }),
  redispatchEvent: op.post('/events/{id}/redispatch', { access: { permission: 'payment:ops:manage' }, audit: '重试支付事件消费者', params: idParam, response: paymentOutboxEventSchema, summary: '重试失败的支付事件消费者' }),
  exceptions: op.get('/exceptions', { access: { permission: 'payment:ops:view' }, query: paymentExceptionListQuery, response: paginated(paymentExceptionSchema), summary: '支付异常列表' }),
  handleException: op.post('/exceptions/{id}/handle', {
    access: { permission: 'payment:ops:manage' },
    audit: '处理支付异常',
    params: idParam,
    body: z.object({
      action: z.enum(['resolve', 'ignore']),
      remark: z.string().trim().max(500).optional(),
    }),
    response: paymentExceptionSchema,
    summary: '标记支付异常已处理或忽略',
  }),
  simulateOrderPaid: op.post('/orders/{id}/simulate-paid', { access: { permission: 'payment:ops:manage' }, audit: '模拟支付成功', params: idParam,
    response: paymentOrderSchema, summary: '模拟支付成功（演示/联调）',
    description: '构造沙箱回调报文送入 handleNotify，与真实渠道回调完全同径（验签/回调日志/幂等/事件/Webhook）。仅沙箱渠道配置可用。' }),
}, { auditModule: '支付中心', tags: ['支付中心-运营'] });
