import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_METHODS } from '../constants';
import { createPaymentFeeRuleSchema, updatePaymentFeeRuleSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentFeeRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  payMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  rateBps: z.int().meta({ description: '费率（万分比）' }),
  fixedFee: z.int().meta({ description: '固定手续费（分）' }),
  minFee: z.int().nullable().optional().meta({ description: '最低手续费（分）' }),
  maxFee: z.int().nullable().optional().meta({ description: '最高手续费（分）' }),
  status: entityStatusSchema,
  priority: z.int(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentFeeRule' });

export type PaymentFeeRule = z.infer<typeof paymentFeeRuleSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentFeeRuleListQuery = paginationQuery.extend({
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: entityStatusSchema.optional(),
});

export const paymentFeeRuleContract = defineContract('/api/payment/fee-rules', {
  list: op.get('/', { query: paymentFeeRuleListQuery, response: paginated(paymentFeeRuleSchema), summary: '费率规则列表' }),
  detail: op.get('/{id}', { params: idParam, response: paymentFeeRuleSchema, summary: '费率规则详情' }),
  create: op.post('/', { body: createPaymentFeeRuleSchema, response: paymentFeeRuleSchema, summary: '新增费率规则' }),
  update: op.put('/{id}', { params: idParam, body: updatePaymentFeeRuleSchema, response: paymentFeeRuleSchema, summary: '编辑费率规则' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除费率规则' }),
}, { tags: ['支付中心-费率'] });
