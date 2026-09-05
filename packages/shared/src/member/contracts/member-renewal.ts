import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CONTRACT_STATUSES, PAYMENT_DEDUCT_PERIODS } from '../../payment/constants';
import { MEMBER_RENEWAL_DEDUCT_STATUSES } from '../constants';
import { memberRenewalApplicationQuery, memberSignRenewalSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 会员端可选续费计划（扣款计划的公开视图） */
export const memberRenewalPlanSchema = z.object({
  id: z.int(),
  name: z.string(),
  period: z.enum(PAYMENT_DEDUCT_PERIODS),
  customDays: z.int().nullable(),
  amount: z.int().meta({ description: '每期金额（分）' }),
  remark: z.string().nullable(),
}).meta({ id: 'MemberRenewalPlan' });

export type MemberRenewalPlan = z.infer<typeof memberRenewalPlanSchema>;

/** 会员端可见的签约协议：只暴露续费页展示所需字段，不含渠道配置与商户信息 */
export const memberRenewalContractSchema = z.object({
  id: z.int(),
  contractNo: z.string(),
  status: z.enum(PAYMENT_CONTRACT_STATUSES),
  planId: z.int(),
  planName: z.string().nullable().optional(),
  planPeriod: z.enum(PAYMENT_DEDUCT_PERIODS).nullable().optional(),
  planAmount: z.int().nullable().optional().meta({ description: '每期金额（分）' }),
  nextDeductAt: z.string().nullable().optional(),
  lastDeductAt: z.string().nullable().optional(),
  failCount: z.int(),
  totalDeductCount: z.int(),
  signedAt: z.string().nullable().optional(),
  terminatedAt: z.string().nullable().optional(),
}).meta({ id: 'MemberRenewalContract' });

export type MemberRenewalContract = z.infer<typeof memberRenewalContractSchema>;

export const memberVipRenewalSchema = z.object({
  id: z.int(),
  orderNo: z.string(),
  contractNo: z.string().nullable(),
  amount: z.int().meta({ description: '本期扣款金额（分）' }),
  vipExpireAfter: z.string().meta({ description: '本期续费后的 VIP 到期时间' }),
  createdAt: z.string(),
}).meta({ id: 'MemberVipRenewal' });

export type MemberVipRenewal = z.infer<typeof memberVipRenewalSchema>;

/** 会员端自动续费视图（VIP 到期 / 当前协议 / 续费记录） */
export const memberRenewalInfoSchema = z.object({
  vipExpireAt: z.string().nullable(),
  contract: memberRenewalContractSchema.nullable(),
  renewals: z.array(memberVipRenewalSchema),
}).meta({ id: 'MemberRenewalInfo' });

export type MemberRenewalInfo = z.infer<typeof memberRenewalInfoSchema>;

/** 单期扣款结果 */
export const memberRenewalDeductResultSchema = z.object({
  orderNo: z.string().nullable(),
  deductStatus: z.enum(MEMBER_RENEWAL_DEDUCT_STATUSES),
  failReason: z.string().nullable().optional(),
}).meta({ id: 'MemberRenewalDeductResult' });

export type MemberRenewalDeductResult = z.infer<typeof memberRenewalDeductResultSchema>;

export const memberRenewalSignResultSchema = z.object({
  contract: memberRenewalContractSchema,
  firstDeduct: memberRenewalDeductResultSchema.nullable().optional().meta({ description: '签约后立即执行的首期扣款结果' }),
}).meta({ id: 'MemberRenewalSignResult' });

export type MemberRenewalSignResult = z.infer<typeof memberRenewalSignResultSchema>;

// ─── 契约（会员登录态） ──────────────────────────────────────────────────────

export const memberRenewalContract = defineContract('/api/member/renewal', {
  plans: op.get('/plans', { query: memberRenewalApplicationQuery, response: z.array(memberRenewalPlanSchema), summary: '可选自动续费计划' }),
  info: op.get('/', { query: memberRenewalApplicationQuery, response: memberRenewalInfoSchema, summary: '我的自动续费状态（VIP 到期 / 协议 / 续费记录）' }),
  sign: op.post('/sign', { body: memberSignRenewalSchema, response: memberRenewalSignResultSchema, summary: '开通自动续费（签约并首期扣款）' }),
  terminate: op.post('/terminate', { query: memberRenewalApplicationQuery, summary: '关闭自动续费（解约）' }),
  deduct: op.post('/deduct', { query: memberRenewalApplicationQuery, response: memberRenewalDeductResultSchema, summary: '立即续费一期（手动扣款）' }),
}, { tags: ['MemberSelf'] });
