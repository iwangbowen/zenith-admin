import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_METHODS } from '../constants';
import { updatePaymentMethodConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentMethodConfigSchema = z.object({
  id: z.int(),
  method: z.enum(PAYMENT_METHODS),
  channel: z.enum(PAYMENT_CHANNELS),
  label: z.string(),
  icon: z.string().nullable().optional(),
  enabled: z.boolean(),
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentMethodConfig' });

export type PaymentMethodConfig = z.infer<typeof paymentMethodConfigSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentMethodContract = defineContract('/api/payment/methods', {
  list: op.get('/', { response: z.array(paymentMethodConfigSchema), summary: '支付方式配置列表' }),
  enabled: op.get('/enabled', { response: z.array(paymentMethodConfigSchema), summary: '可用支付方式（供下单选择）' }),
  detail: op.get('/{id}', { params: idParam, response: paymentMethodConfigSchema, summary: '支付方式配置详情' }),
  update: op.put('/{id}', { params: idParam, body: updatePaymentMethodConfigSchema, response: paymentMethodConfigSchema, summary: '编辑支付方式配置（启停/排序/名称/图标）' }),
}, { tags: ['支付中心-支付方式'] });
