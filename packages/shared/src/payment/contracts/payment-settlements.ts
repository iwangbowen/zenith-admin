import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_SETTLEMENT_STATUSES } from '../constants';
import { createPaymentSettlementSchema, transitionPaymentSettlementSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentSettlementBatchSchema = z.object({
  id: z.int(),
  batchNo: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  periodStart: z.string().meta({ description: '账期起 YYYY-MM-DD' }),
  periodEnd: z.string().meta({ description: '账期止 YYYY-MM-DD' }),
  status: z.enum(PAYMENT_SETTLEMENT_STATUSES),
  orderCount: z.int(),
  grossAmount: z.int().meta({ description: '成功收款（分）' }),
  feeAmount: z.int().meta({ description: '手续费（分）' }),
  refundAmount: z.int().meta({ description: '退款（分）' }),
  sharingAmount: z.int().meta({ description: '账期内分账支出合计（分），净额已扣除' }),
  netAmount: z.int().meta({ description: '净额（分）' }),
  settledAt: z.string().nullable().optional(),
  failureReason: z.string().nullable().optional(),
  payoutReference: z.string().nullable().optional(),
  version: z.int().nonnegative(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentSettlementBatch' });

export type PaymentSettlementBatch = z.infer<typeof paymentSettlementBatchSchema>;

/** 结算批次逐笔资金明细（金额为最小货币单位的十进制字符串，可为负） */
export const paymentSettlementItemSchema = z.object({
  id: z.int(),
  batchId: z.int(),
  journalLineId: z.int(),
  amount: z.string().meta({ description: '最小货币单位的十进制字符串，可为负', example: '-1200' }),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  createdAt: z.string(),
}).meta({ id: 'PaymentSettlementItem' });

export type PaymentSettlementItem = z.infer<typeof paymentSettlementItemSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentSettlementListQuery = paginationQuery.extend({
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: z.enum(PAYMENT_SETTLEMENT_STATUSES).optional(),
});

export const paymentSettlementContract = defineContract('/api/payment/settlements', {
  list: op.get('/', { query: paymentSettlementListQuery, response: paginated(paymentSettlementBatchSchema), summary: '结算批次列表' }),
  items: op.get('/{id}/items', { params: idParam, response: z.array(paymentSettlementItemSchema), summary: '结算批次逐笔资金明细' }),
  detail: op.get('/{id}', { params: idParam, response: paymentSettlementBatchSchema, summary: '结算批次详情' }),
  generate: op.post('/generate', { body: createPaymentSettlementSchema, response: paymentSettlementBatchSchema, summary: '生成结算批次（聚合账期成功订单）' }),
  transition: op.post('/{id}/status', { params: idParam, body: transitionPaymentSettlementSchema, response: paymentSettlementBatchSchema, summary: '结算批次状态流转（结算中/已结算/失败）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除结算批次' }),
}, { tags: ['支付中心-结算'] });
