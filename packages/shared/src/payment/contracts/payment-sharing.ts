import * as z from 'zod';
import { dateRangeBound, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_SHARING_ORDER_STATUSES, PAYMENT_SHARING_RECEIVER_TYPES, PAYMENT_SHARING_REVERSAL_STATUSES } from '../constants';
import {
  createPaymentSharingReceiverSchema,
  createPaymentSharingReversalSchema,
  dispatchPaymentSharingSchema,
  idempotencyKeyHeaders,
  updatePaymentSharingReceiverSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentSharingReceiverSchema = z.object({
  id: z.int(),
  name: z.string(),
  receiverType: z.enum(PAYMENT_SHARING_RECEIVER_TYPES),
  account: z.string(),
  ratioBps: z.int().nullable().optional().meta({ description: '分账比例（万分比）' }),
  autoShare: z.boolean().meta({ description: '自动分账：支付成功后按 ratioBps 自动发起分账' }),
  status: entityStatusSchema,
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentSharingReceiver' });

export type PaymentSharingReceiver = z.infer<typeof paymentSharingReceiverSchema>;

export const paymentSharingOrderSchema = z.object({
  id: z.int(),
  sharingNo: z.string(),
  orderNo: z.string(),
  receiverId: z.int(),
  receiverName: z.string().nullable().optional(),
  amount: z.int().meta({ description: '分账金额（分）' }),
  status: z.enum(PAYMENT_SHARING_ORDER_STATUSES),
  channelSharingNo: z.string().nullable().optional(),
  version: z.int().nonnegative(),
  finishedAt: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentSharingOrder' });

export type PaymentSharingOrder = z.infer<typeof paymentSharingOrderSchema>;

export const paymentSharingReversalSchema = z.object({
  id: z.int(),
  reversalNo: z.string(),
  sharingOrderId: z.int(),
  sharingNo: z.string(),
  orderNo: z.string(),
  amount: z.int().meta({ description: '冲正金额（分）' }),
  status: z.enum(PAYMENT_SHARING_REVERSAL_STATUSES),
  channelReversalNo: z.string().nullable().optional(),
  reason: z.string(),
  attempts: z.int().nonnegative(),
  queryAttempts: z.int().nonnegative(),
  version: z.int().nonnegative(),
  errorMessage: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentSharingReversal' });

export type PaymentSharingReversal = z.infer<typeof paymentSharingReversalSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentSharingReceiverListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: entityStatusSchema.optional(),
});

export const paymentSharingOrderListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(PAYMENT_SHARING_ORDER_STATUSES).optional(),
  receiverId: z.coerce.number().int().optional(),
});

export const paymentSharingReversalListQuery = paginationQuery.extend({
  sharingOrderId: z.coerce.number().int().positive().optional(),
  status: z.enum(PAYMENT_SHARING_REVERSAL_STATUSES).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

/** 分账：接收方 / 分账单 / 分账冲正共用一个路由根 */
export const paymentSharingContract = defineContract('/api/payment/sharing', {
  receivers: op.get('/receivers', { query: paymentSharingReceiverListQuery, response: paginated(paymentSharingReceiverSchema), summary: '分账接收方列表' }),
  receiverDetail: op.get('/receivers/{id}', { params: idParam, response: paymentSharingReceiverSchema, summary: '分账接收方详情' }),
  createReceiver: op.post('/receivers', { body: createPaymentSharingReceiverSchema, response: paymentSharingReceiverSchema, summary: '新增分账接收方' }),
  updateReceiver: op.put('/receivers/{id}', { params: idParam, body: updatePaymentSharingReceiverSchema, response: paymentSharingReceiverSchema, summary: '编辑分账接收方' }),
  removeReceiver: op.delete('/receivers/{id}', { params: idParam, summary: '删除分账接收方' }),
  orders: op.get('/orders', { query: paymentSharingOrderListQuery, response: paginated(paymentSharingOrderSchema), summary: '分账单列表' }),
  dispatch: op.post('/orders', { body: dispatchPaymentSharingSchema, response: paymentSharingOrderSchema, summary: '发起分账' }),
  reversals: op.get('/reversals', { query: paymentSharingReversalListQuery, response: paginated(paymentSharingReversalSchema), summary: '分账冲正列表' }),
  reverse: op.post('/orders/{id}/reverse', {
    params: idParam,
    headers: idempotencyKeyHeaders,
    body: createPaymentSharingReversalSchema,
    response: paymentSharingReversalSchema,
    summary: '发起分账冲正',
  }),
  queryReversal: op.post('/reversals/{id}/query', { params: idParam, response: paymentSharingReversalSchema, summary: '查询分账冲正结果' }),
  reversalDetail: op.get('/reversals/{id}', { params: idParam, response: paymentSharingReversalSchema, summary: '分账冲正详情' }),
}, { tags: ['支付中心-分账'] });
