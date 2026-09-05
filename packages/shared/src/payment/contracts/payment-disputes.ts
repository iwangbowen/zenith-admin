import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CHANNELS,
  PAYMENT_DISPUTE_REPLY_AUTHORS,
  PAYMENT_DISPUTE_ROUTES,
  PAYMENT_DISPUTE_STATUSES,
  PAYMENT_DISPUTE_TYPES,
  PAYMENT_ORDER_STATUSES,
} from '../constants';
import {
  refundPaymentDisputeSchema,
  replyPaymentDisputeSchema,
  resolvePaymentDisputeSchema,
  simulatePaymentDisputeSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 交易投诉 / 争议工单 */
export const paymentDisputeSchema = z.object({
  id: z.int(),
  disputeNo: z.string(),
  channelDisputeNo: z.string().nullable().optional(),
  channel: z.enum(PAYMENT_CHANNELS),
  orderNo: z.string(),
  complainant: z.string().nullable().optional(),
  complainantPhone: z.string().nullable().optional(),
  type: z.enum(PAYMENT_DISPUTE_TYPES),
  content: z.string(),
  amount: z.int().meta({ description: '涉诉金额（分）' }),
  status: z.enum(PAYMENT_DISPUTE_STATUSES),
  route: z.string().nullable().meta({ description: '智能分流路由（urgent/manual/auto_refund_suggest；null=未分流走默认队列）' }),
  priority: z.int().nullable().meta({ description: '分流优先级，数值越大越紧急' }),
  slaHours: z.int().nullable().meta({ description: '分流建议 SLA（小时）' }),
  deadline: z.string().nullable().optional(),
  overdue: z.boolean().meta({ description: '是否已超时（未完结且已过处理时效）' }),
  refundNo: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentDispute' });

export type PaymentDispute = z.infer<typeof paymentDisputeSchema>;

export const paymentDisputeReplySchema = z.object({
  id: z.int(),
  author: z.enum(PAYMENT_DISPUTE_REPLY_AUTHORS),
  content: z.string(),
  operatorName: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'PaymentDisputeReply' });

export type PaymentDisputeReply = z.infer<typeof paymentDisputeReplySchema>;

/** 关联订单摘要 */
export const paymentDisputeOrderSummarySchema = z.object({
  orderNo: z.string(),
  subject: z.string(),
  amount: z.int(),
  status: z.enum(PAYMENT_ORDER_STATUSES),
  paidAt: z.string().nullable().optional(),
}).meta({ id: 'PaymentDisputeOrderSummary' });

export type PaymentDisputeOrderSummary = z.infer<typeof paymentDisputeOrderSummarySchema>;

export const paymentDisputeDetailSchema = paymentDisputeSchema.extend({
  replies: z.array(paymentDisputeReplySchema),
  order: paymentDisputeOrderSummarySchema.nullable().optional(),
}).meta({ id: 'PaymentDisputeDetail' });

export type PaymentDisputeDetail = z.infer<typeof paymentDisputeDetailSchema>;

export const paymentDisputeStatsSchema = z.object({
  open: z.int().meta({ description: '未完结工单数' }),
  overdue: z.int().meta({ description: '超时未完结工单数' }),
  last30dCount: z.int().meta({ description: '近 30 天投诉单量' }),
  last30dRate: z.number().meta({ description: '近 30 天投诉率（投诉数 / 成功订单数，百分比数值，如 1.25 表示 1.25%）' }),
  avgResolveHours: z.number().meta({ description: '平均处理时长（小时，仅统计已完结）' }),
}).meta({ id: 'PaymentDisputeStats' });

export type PaymentDisputeStats = z.infer<typeof paymentDisputeStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentDisputeListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(PAYMENT_DISPUTE_STATUSES).optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  type: z.enum(PAYMENT_DISPUTE_TYPES).optional(),
  route: z.enum(PAYMENT_DISPUTE_ROUTES).optional(),
  overdueOnly: queryBool('只看已超时工单'),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const paymentDisputeContract = defineContract('/api/payment/disputes', {
  list: op.get('/', { query: paymentDisputeListQuery, response: paginated(paymentDisputeSchema), summary: '投诉工单列表' }),
  stats: op.get('/stats', { response: paymentDisputeStatsSchema, summary: '投诉统计（待处理/超时/30天投诉率/平均时长）' }),
  detail: op.get('/{id}', { params: idParam, response: paymentDisputeDetailSchema, summary: '投诉工单详情（含时间线与订单摘要）' }),
  reply: op.post('/{id}/reply', { params: idParam, body: replyPaymentDisputeSchema, response: paymentDisputeDetailSchema, summary: '商户回复投诉' }),
  resolve: op.post('/{id}/resolve', { params: idParam, body: resolvePaymentDisputeSchema, response: paymentDisputeDetailSchema, summary: '完结投诉（协商解决）' }),
  refund: op.post('/{id}/refund', {
    params: idParam,
    body: refundPaymentDisputeSchema,
    response: paymentDisputeDetailSchema,
    summary: '投诉退款（复用退款审批链路）',
    description: '资金流出接口，挂幂等防重复提交；大额退款自动进入退款审批。',
  }),
  simulate: op.post('/simulate', { body: simulatePaymentDisputeSchema, response: paymentDisputeSchema, summary: '模拟一条投诉（演示/联调）' }),
}, { tags: ['支付中心-交易投诉'] });
