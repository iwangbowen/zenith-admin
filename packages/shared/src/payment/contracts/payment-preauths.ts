import * as z from 'zod';
import { dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryEnum, requiredIdQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_PREAUTH_STATUSES, PAYMENT_PREAUTH_UNKNOWN_OPERATIONS } from '../constants';
import { capturePaymentPreauthSchema, createPaymentPreauthSchema } from '../validation';
import { paymentApplicationQuery } from './_query';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 预授权单（资金冻结 / 解冻 / 转支付） */
export const paymentPreauthSchema = z.object({
  id: z.int(),
  preauthNo: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  channelConfigId: z.int(),
  channelAccountId: z.int(),
  credentialVersion: z.int(),
  appId: z.int(),
  currency: z.string(),
  channelPreauthNo: z.string().nullable().optional(),
  bizType: z.string(),
  bizId: z.string(),
  subject: z.string(),
  payerAccount: z.string(),
  frozenAmount: z.int().meta({ description: '冻结金额（分）' }),
  capturedAmount: z.int().nullable().optional().meta({ description: '已转支付金额（分）' }),
  captureOrderNo: z.string().nullable().optional(),
  status: z.enum(PAYMENT_PREAUTH_STATUSES),
  unknownOperation: z.enum(PAYMENT_PREAUTH_UNKNOWN_OPERATIONS).nullable().optional(),
  version: z.int().nonnegative(),
  errorMessage: z.string().nullable().optional(),
  frozenAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  operatorName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentPreauth' });

export type PaymentPreauth = z.infer<typeof paymentPreauthSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentPreauthListQuery = paginationQuery.extend({
  applicationId: requiredIdQuery(),
  keyword: keywordQuery(),
  status: queryEnum(PAYMENT_PREAUTH_STATUSES),
  channel: queryEnum(PAYMENT_CHANNELS),
  ...dateRangeQuery(),
});

export const paymentPreauthContract = defineContract('/api/payment/preauths', {
  list: op.get('/', { access: { permission: 'payment:preauth:list' }, query: paymentPreauthListQuery, response: paginated(paymentPreauthSchema), summary: '预授权单列表' }),
  create: op.post('/', {
    access: { permission: 'payment:preauth:manage' }, audit: '发起预授权冻结',
    body: createPaymentPreauthSchema,
    response: paymentPreauthSchema,
    summary: '发起预授权冻结（沙箱即时生效）',
    description: '资金冻结接口，挂幂等防重复提交；真实渠道需商户开通资金授权产品权限。',
  }),
  capture: op.post('/{id}/capture', {
    access: { permission: 'payment:preauth:manage' }, audit: '预授权转支付',
    params: idParam,
    query: paymentApplicationQuery,
    body: capturePaymentPreauthSchema,
    response: paymentPreauthSchema,
    summary: '转支付（冻结资金转正式交易，剩余自动解冻）',
    description: '资金操作接口，挂幂等防重复提交；生成支付订单并走完整履约链。',
  }),
  release: op.post('/{id}/release', { access: { permission: 'payment:preauth:manage' }, audit: '预授权解冻', params: idParam, query: paymentApplicationQuery, response: paymentPreauthSchema, summary: '解冻（全额释放冻结资金）' }),
  recover: op.post('/{id}/recover', {
    access: { permission: 'payment:preauth:manage' }, audit: '查询恢复预授权',
    params: idParam,
    query: paymentApplicationQuery,
    response: paymentPreauthSchema,
    summary: '查询并恢复未知预授权状态',
    description: '仅当渠道适配器明确声明 preauth.query 能力时收敛；否则保持原状态并记录原因。',
  }),
}, { auditModule: '支付中心', tags: ['支付中心-预授权'] });
