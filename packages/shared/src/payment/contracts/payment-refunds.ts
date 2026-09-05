import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_REFUND_APPROVAL_STATUSES, PAYMENT_REFUND_STATUSES } from '../constants';
import { approveRefundSchema, createRefundSchema, idempotencyKeyHeaders, rejectRefundSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentRefundSchema = z.object({
  id: z.int(),
  refundNo: z.string(),
  outRefundNo: z.string(),
  orderNo: z.string(),
  orderId: z.int(),
  channelRefundNo: z.string().nullable().optional(),
  channel: z.enum(PAYMENT_CHANNELS),
  refundAmount: z.int().meta({ description: '退款金额（分）' }),
  totalAmount: z.int().meta({ description: '原订单金额（分）' }),
  reason: z.string().nullable().optional(),
  status: z.enum(PAYMENT_REFUND_STATUSES),
  approvalStatus: z.enum(PAYMENT_REFUND_APPROVAL_STATUSES),
  appliedById: z.int().nullable().optional(),
  approverId: z.int().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  approvalRemark: z.string().nullable().optional(),
  operatorId: z.int().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  version: z.int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentRefund' });

export type PaymentRefund = z.infer<typeof paymentRefundSchema>;

/** 发起 / 审批退款的即时结果：退款单号 + 当前状态（pending=待审批，processing=渠道处理中） */
export const paymentRefundResultSchema = z.object({
  refundNo: z.string(),
  status: z.string(),
}).meta({ id: 'PaymentRefundResult' });

export type PaymentRefundResult = z.infer<typeof paymentRefundResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentRefundListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: z.enum(PAYMENT_REFUND_STATUSES).optional(),
  approvalStatus: z.enum(PAYMENT_REFUND_APPROVAL_STATUSES).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

/** 退款：与商户配置 / 订单 / 签约代扣共用 `/api/payment` 根，操作名在根内唯一 */
export const paymentRefundContract = defineContract('/api/payment', {
  orderRefunds: op.get('/orders/{id}/refunds', { params: idParam, response: z.array(paymentRefundSchema), summary: '支付订单关联退款' }),
  createRefund: op.post('/refunds', { headers: idempotencyKeyHeaders, body: createRefundSchema, response: paymentRefundResultSchema, summary: '发起退款' }),
  refunds: op.get('/refunds', { query: paymentRefundListQuery, response: paginated(paymentRefundSchema), summary: '退款记录列表' }),
  refundDetail: op.get('/refunds/{id}', { params: idParam, response: paymentRefundSchema, summary: '退款详情' }),
  queryRefund: op.post('/refunds/{id}/query', {
    params: idParam,
    response: paymentRefundSchema,
    summary: '主动查询并同步退款状态',
    description: '向支付渠道发起退款查单，纠正本地退款单状态（处理中→成功/失败），回调兜底。',
  }),
  approveRefund: op.post('/refunds/{id}/approve', { params: idParam, body: approveRefundSchema, response: paymentRefundResultSchema, summary: '审批通过退款并执行' }),
  rejectRefund: op.post('/refunds/{id}/reject', { params: idParam, body: rejectRefundSchema, summary: '驳回退款' }),
}, { tags: ['支付中心'] });
