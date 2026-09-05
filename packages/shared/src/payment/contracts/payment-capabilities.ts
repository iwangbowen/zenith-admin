import * as z from 'zod';
import { entityStatusSchema } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CAPABILITY_REASON_CODES,
  PAYMENT_CHANNELS,
  PAYMENT_ENGINE_MODES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDER_ENVIRONMENTS,
  PAYMENT_PROVIDER_EXECUTIONS,
  PAYMENT_PROVIDER_OPERATIONS,
} from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 操作限额（适配器声明） */
export const paymentCapabilityLimitsSchema = z.object({
  maxAmount: z.int().nullable().meta({ description: '单笔上限（分）' }),
  receiverNameRequiredAtOrAbove: z.int().nullable().meta({ description: '达到该金额（分）须提供收款人姓名' }),
}).meta({ id: 'PaymentCapabilityLimits' });

export type PaymentCapabilityLimits = z.infer<typeof paymentCapabilityLimitsSchema>;

/** 单项有效能力：适配器声明 × 当前商户配置 × 运行模式 × 支付方式启停 */
export const paymentEffectiveCapabilitySchema = z.object({
  operation: z.enum(PAYMENT_PROVIDER_OPERATIONS),
  environment: z.enum(PAYMENT_PROVIDER_ENVIRONMENTS),
  declaredEnvironments: z.array(z.enum(PAYMENT_PROVIDER_ENVIRONMENTS)),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  currency: z.string(),
  execution: z.enum(PAYMENT_PROVIDER_EXECUTIONS).nullable(),
  limits: paymentCapabilityLimitsSchema.nullable(),
  supported: z.boolean(),
  reasonCode: z.enum(PAYMENT_CAPABILITY_REASON_CODES).nullable(),
  reason: z.string().nullable(),
  missingConfigFields: z.array(z.string()),
}).meta({ id: 'PaymentEffectiveCapability' });

export type PaymentEffectiveCapability = z.infer<typeof paymentEffectiveCapabilitySchema>;

/** 单个商户配置的能力清单 */
export const paymentConfigCapabilitiesSchema = z.object({
  channelConfigId: z.int(),
  tenantId: z.int().nullable(),
  configName: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  environment: z.enum(PAYMENT_PROVIDER_ENVIRONMENTS),
  configStatus: entityStatusSchema,
  providerName: z.string(),
  supported: z.boolean(),
  reason: z.string().nullable(),
  capabilities: z.array(paymentEffectiveCapabilitySchema),
}).meta({ id: 'PaymentConfigCapabilities' });

export type PaymentConfigCapabilities = z.infer<typeof paymentConfigCapabilitiesSchema>;

export const paymentCapabilitiesResponseSchema = z.object({
  engineMode: z.enum(PAYMENT_ENGINE_MODES),
  configs: z.array(paymentConfigCapabilitiesSchema),
}).meta({ id: 'PaymentCapabilitiesResponse' });

export type PaymentCapabilitiesResponse = z.infer<typeof paymentCapabilitiesResponseSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentCapabilityQuery = z.object({
  channelConfigId: z.coerce.number().int().positive().optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  operation: z.enum(PAYMENT_PROVIDER_OPERATIONS).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()).optional(),
});

export type PaymentCapabilityQuery = z.output<typeof paymentCapabilityQuery>;

export const paymentCapabilityContract = defineContract('/api/payment/capabilities', {
  list: op.get('/', {
    query: paymentCapabilityQuery,
    response: paymentCapabilitiesResponseSchema,
    summary: '查询支付渠道有效能力',
    description: '返回适配器声明能力与当前商户配置、运行模式、支付方式启停的交集，并给出不可用原因。',
  }),
}, { tags: ['支付中心-渠道能力'] });
