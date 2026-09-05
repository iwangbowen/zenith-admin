import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_APP_ENVIRONMENTS } from '../constants';
import { createPaymentAppSchema, updatePaymentAppSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 支付应用（App 维度）：外部身份由开放平台客户端管理，这里只维护支付渠道路由 */
export const paymentAppSchema = z.object({
  id: z.int(),
  name: z.string(),
  openClientId: z.int(),
  openClientKey: z.string(),
  openClientName: z.string(),
  environment: z.enum(PAYMENT_APP_ENVIRONMENTS),
  status: entityStatusSchema,
  wechatConfigId: z.int().nullable().optional(),
  wechatConfigName: z.string().nullable().optional(),
  alipayConfigId: z.int().nullable().optional(),
  alipayConfigName: z.string().nullable().optional(),
  unionpayConfigId: z.int().nullable().optional(),
  unionpayConfigName: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentApp' });

export type PaymentApp = z.infer<typeof paymentAppSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentAppListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: entityStatusSchema.optional(),
});

export const paymentAppContract = defineContract('/api/payment/apps', {
  list: op.get('/', { query: paymentAppListQuery, response: paginated(paymentAppSchema), summary: '支付应用列表' }),
  detail: op.get('/{id}', { params: idParam, response: paymentAppSchema, summary: '支付应用详情' }),
  create: op.post('/', { body: createPaymentAppSchema, response: paymentAppSchema, summary: '新增支付应用' }),
  update: op.put('/{id}', { params: idParam, body: updatePaymentAppSchema, response: paymentAppSchema, summary: '编辑支付应用' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除支付应用' }),
}, { tags: ['支付中心-应用'] });
