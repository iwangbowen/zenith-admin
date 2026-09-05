import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_DEDUCT_PERIODS } from '../constants';
import { createPaymentDeductPlanSchema, updatePaymentDeductPlanSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentDeductPlanSchema = z.object({
  id: z.int(),
  name: z.string(),
  period: z.enum(PAYMENT_DEDUCT_PERIODS),
  customDays: z.int().nullable().optional(),
  amount: z.int().meta({ description: '每期扣款金额（分）' }),
  maxRetries: z.int(),
  status: entityStatusSchema,
  remark: z.string().nullable().optional(),
  contractCount: z.int().optional().meta({ description: '引用本计划的协议数（列表页展示 / 删除预检）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentDeductPlan' });

export type PaymentDeductPlan = z.infer<typeof paymentDeductPlanSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentDeductPlanListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: entityStatusSchema.optional(),
});

/** 扣款计划：与签约协议同挂支付资源根，操作名在根内唯一 */
export const paymentDeductPlanContract = defineContract('/api/payment', {
  deductPlans: op.get('/deduct-plans', { query: paymentDeductPlanListQuery, response: paginated(paymentDeductPlanSchema), summary: '扣款计划列表' }),
  deductPlansAll: op.get('/deduct-plans/all', { response: z.array(paymentDeductPlanSchema), summary: '全量启用扣款计划（下拉）' }),
  createDeductPlan: op.post('/deduct-plans', { body: createPaymentDeductPlanSchema, response: paymentDeductPlanSchema, summary: '创建扣款计划' }),
  updateDeductPlan: op.put('/deduct-plans/{id}', { params: idParam, body: updatePaymentDeductPlanSchema, response: paymentDeductPlanSchema, summary: '更新扣款计划' }),
  removeDeductPlan: op.delete('/deduct-plans/{id}', { params: idParam, summary: '删除扣款计划（无协议引用时）' }),
}, { tags: ['支付中心-签约代扣'] });
