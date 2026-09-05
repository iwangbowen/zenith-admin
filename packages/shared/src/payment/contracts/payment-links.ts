import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CASHIER_METHODS,
  PAYMENT_CASHIER_SESSION_STATUSES,
  PAYMENT_CASHIER_USE_SLOT_STATUSES,
  PAYMENT_LINK_STATUSES,
  PAYMENT_LINK_UNAVAILABLE_REASONS,
  PAYMENT_METHODS,
} from '../constants';
import { createPaymentLinkSchema, payPaymentLinkSchema, updatePaymentLinkSchema } from '../validation';
import { createPaymentResultSchema } from './payment-orders';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentLinkSchema = z.object({
  id: z.int(),
  linkNo: z.string(),
  token: z.string(),
  appId: z.int(),
  subject: z.string(),
  amount: z.int().nullable().optional().meta({ description: '金额（分），null=用户填写' }),
  payMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  bizType: z.string(),
  maxUses: z.int().nullable().optional(),
  usedCount: z.int(),
  reservedCount: z.int().nonnegative(),
  expiredAt: z.string().nullable().optional(),
  status: z.enum(PAYMENT_LINK_STATUSES),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentLink' });

export type PaymentLink = z.infer<typeof paymentLinkSchema>;

/** 收银台可选支付方式 */
export const paymentLinkAvailableMethodSchema = z.object({
  method: z.enum(PAYMENT_CASHIER_METHODS),
  label: z.string(),
  icon: z.string().nullable().optional(),
}).meta({ id: 'PaymentLinkAvailableMethod' });

export type PaymentLinkAvailableMethod = z.infer<typeof paymentLinkAvailableMethodSchema>;

/** 支付链接公开视图（C 端展示，不含敏感 / 审计字段） */
export const paymentLinkPublicSchema = z.object({
  token: z.string(),
  subject: z.string(),
  amount: z.int().nullable().optional().meta({ description: '金额（分），null=用户填写' }),
  payMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  bizType: z.string(),
  status: z.enum(PAYMENT_LINK_STATUSES),
  unavailableReason: z.enum(PAYMENT_LINK_UNAVAILABLE_REASONS).nullable().optional(),
  expiredAt: z.string().nullable().optional(),
  remainingUses: z.int().nullable().optional(),
  availableMethods: z.array(paymentLinkAvailableMethodSchema),
}).meta({ id: 'PaymentLinkPublic' });

export type PaymentLinkPublic = z.infer<typeof paymentLinkPublicSchema>;

/** 公开收银台会话：用于第三方跳转、刷新和回跳后的状态恢复 */
export const paymentCashierSessionSchema = z.object({
  sessionToken: z.string(),
  linkId: z.int(),
  appId: z.int(),
  orderNo: z.string().nullable().optional(),
  payMethod: z.enum(PAYMENT_CASHIER_METHODS),
  amount: z.int(),
  status: z.enum(PAYMENT_CASHIER_SESSION_STATUSES),
  useSlotStatus: z.enum(PAYMENT_CASHIER_USE_SLOT_STATUSES),
  payParams: createPaymentResultSchema.nullable().optional(),
  returnUrl: z.string(),
  errorMessage: z.string().nullable().optional(),
  expiresAt: z.string(),
  version: z.int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentCashierSession' });

export type PaymentCashierSession = z.infer<typeof paymentCashierSessionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentLinkListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(PAYMENT_LINK_STATUSES).optional(),
});

export const paymentLinkContract = defineContract('/api/payment/links', {
  list: op.get('/', { query: paymentLinkListQuery, response: paginated(paymentLinkSchema), summary: '支付链接列表' }),
  detail: op.get('/{id}', { params: idParam, response: paymentLinkSchema, summary: '支付链接详情' }),
  create: op.post('/', { body: createPaymentLinkSchema, response: paymentLinkSchema, summary: '新增支付链接' }),
  update: op.put('/{id}', { params: idParam, body: updatePaymentLinkSchema, response: paymentLinkSchema, summary: '编辑支付链接' }),
  rotateToken: op.post('/{id}/rotate-token', { params: idParam, response: paymentLinkSchema, summary: '重置链接 token（安全轮换，旧链接立即失效）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除支付链接' }),
}, { tags: ['支付中心-支付链接'] });

export const paymentLinkTokenParam = z.object({
  token: z.string().min(8).max(64).meta({ description: '支付链接 token', example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }),
});

export const paymentCashierSessionParam = paymentLinkTokenParam.extend({
  sessionToken: z.string().min(40).max(64).meta({ description: '收银台会话 token' }),
});

/** 支付链接公开端点（无需登录，供 C 端用户访问收款链接 / 收款码） */
export const paymentLinkPublicContract = defineContract('/api/public/payment/link', {
  detail: op.get('/{token}', { public: true, params: paymentLinkTokenParam, response: paymentLinkPublicSchema, summary: '获取支付链接信息（公开，无需登录）' }),
  pay: op.post('/{token}/pay', { public: true, params: paymentLinkTokenParam, body: payPaymentLinkSchema, response: paymentCashierSessionSchema, summary: '通过支付链接下单（公开，无需登录）' }),
  session: op.get('/{token}/sessions/{sessionToken}', { public: true, params: paymentCashierSessionParam, response: paymentCashierSessionSchema, summary: '恢复收银台会话并同步支付状态' }),
}, { tags: ['支付链接（公开）'] });
