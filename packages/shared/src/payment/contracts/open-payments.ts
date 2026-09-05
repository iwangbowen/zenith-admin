import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_APP_ENVIRONMENTS,
  PAYMENT_CHANNELS,
  PAYMENT_METHODS,
  PAYMENT_ORDER_STATUSES,
  PAYMENT_PROVIDER_EXECUTIONS,
  PAYMENT_REFUND_APPROVAL_STATUSES,
  PAYMENT_REFUND_STATUSES,
} from '../constants';
import { createOpenPaymentIntentSchema, createOpenPaymentRefundSchema, idempotencyKeyHeaders } from '../validation';
import { paymentCapabilityLimitsSchema } from './payment-capabilities';
import { createPaymentResultSchema } from './payment-orders';

// ─── 实体（对外视角：不暴露内部 id / 商户配置 / 租户）──────────────────────────

export const openPaymentIntentSchema = z.object({
  orderNo: z.string(),
  bizType: z.string(),
  bizId: z.string(),
  subject: z.string(),
  amount: z.int().meta({ description: '金额（分）' }),
  currency: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  payMethod: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_ORDER_STATUSES),
  paidAmount: z.int().nullable(),
  paidAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OpenPaymentIntent' });

export type OpenPaymentIntent = z.infer<typeof openPaymentIntentSchema>;

export const openPaymentIntentCreatedSchema = z.object({
  intent: openPaymentIntentSchema,
  payParams: createPaymentResultSchema,
}).meta({ id: 'OpenPaymentIntentCreated' });

export type OpenPaymentIntentCreated = z.infer<typeof openPaymentIntentCreatedSchema>;

export const openPaymentRefundSchema = z.object({
  refundNo: z.string(),
  orderNo: z.string(),
  refundAmount: z.int().meta({ description: '退款金额（分）' }),
  status: z.enum(PAYMENT_REFUND_STATUSES),
  approvalStatus: z.enum(PAYMENT_REFUND_APPROVAL_STATUSES),
  refundedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OpenPaymentRefund' });

export type OpenPaymentRefund = z.infer<typeof openPaymentRefundSchema>;

export const openPaymentCapabilitySchema = z.object({
  channel: z.enum(PAYMENT_CHANNELS),
  operation: z.string(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  currency: z.string(),
  execution: z.enum(PAYMENT_PROVIDER_EXECUTIONS).nullable(),
  limits: paymentCapabilityLimitsSchema.nullable(),
  supported: z.boolean(),
  reasonCode: z.string().nullable(),
  reason: z.string().nullable(),
}).meta({ id: 'OpenPaymentCapability' });

export type OpenPaymentCapability = z.infer<typeof openPaymentCapabilitySchema>;

export const openPaymentApplicationCapabilitiesSchema = z.object({
  clientId: z.string(),
  environment: z.enum(PAYMENT_APP_ENVIRONMENTS),
  capabilities: z.array(openPaymentCapabilitySchema),
}).meta({ id: 'OpenPaymentApplicationCapabilities' });

export type OpenPaymentApplicationCapabilities = z.infer<typeof openPaymentApplicationCapabilitiesSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const openPaymentOrderNoParam = z.object({
  orderNo: z.string().min(1).max(64).meta({ description: '支付订单号' }),
});

export const openPaymentRefundNoParam = z.object({
  refundNo: z.string().min(1).max(64).meta({ description: '退款单号' }),
});

/**
 * 支付开放 API：应用、租户与商户路由全部由已验签 principal 推导。
 * 鉴权 / 计量 / 限流由开放网关中间件统一施加，各端点只声明所需 scope。
 */
export const openPaymentContract = defineContract('/api/open', {
  createIntent: op.post('/v1/payments/intents', {
    security: 'open-gateway',
    headers: idempotencyKeyHeaders,
    body: createOpenPaymentIntentSchema,
    response: openPaymentIntentCreatedSchema,
    summary: '创建支付意图',
    description: '所需 scope：payment:intent:create；仅签名通道可调用。',
  }),
  intentDetail: op.get('/v1/payments/intents/{orderNo}', {
    security: 'open-gateway',
    params: openPaymentOrderNoParam,
    response: openPaymentIntentSchema,
    summary: '读取支付意图',
    description: '所需 scope：payment:intent:read。',
  }),
  createRefund: op.post('/v1/payments/refunds', {
    security: 'open-gateway',
    headers: idempotencyKeyHeaders,
    body: createOpenPaymentRefundSchema,
    response: openPaymentRefundSchema,
    summary: '创建退款',
    description: '所需 scope：payment:refund:create；仅签名通道可调用。',
  }),
  refundDetail: op.get('/v1/payments/refunds/{refundNo}', {
    security: 'open-gateway',
    params: openPaymentRefundNoParam,
    response: openPaymentRefundSchema,
    summary: '读取退款',
    description: '所需 scope：payment:refund:read。',
  }),
  capabilities: op.get('/v1/payments/capabilities', {
    security: 'open-gateway',
    response: openPaymentApplicationCapabilitiesSchema,
    summary: '读取当前应用支付能力',
    description: '所需 scope：payment:intent:read。',
  }),
}, { tags: ['开放API-支付'] });
