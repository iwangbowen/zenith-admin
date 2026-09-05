import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CHANNELS,
  PAYMENT_CONTRACT_STATUSES,
  PAYMENT_CONTRACT_UNKNOWN_OPERATIONS,
  PAYMENT_DEDUCT_PERIODS,
  PAYMENT_DEDUCT_RESULT_STATUSES,
} from '../constants';
import { createPaymentContractSchema } from '../validation';
import { paymentApplicationQuery } from './_query';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 签约协议（周期扣款 / 订阅） */
export const paymentContractSchema = z.object({
  id: z.int(),
  contractNo: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  channelConfigId: z.int(),
  appId: z.int(),
  currency: z.string(),
  planId: z.int(),
  planName: z.string().nullable().optional(),
  planPeriod: z.enum(PAYMENT_DEDUCT_PERIODS).nullable().optional(),
  planAmount: z.int().nullable().optional().meta({ description: '每期金额（分）' }),
  signerAccount: z.string(),
  signerName: z.string().nullable().optional(),
  status: z.enum(PAYMENT_CONTRACT_STATUSES),
  unknownOperation: z.enum(PAYMENT_CONTRACT_UNKNOWN_OPERATIONS).nullable().optional(),
  version: z.int().nonnegative(),
  errorMessage: z.string().nullable().optional(),
  channelContractNo: z.string().nullable().optional(),
  bizType: z.string(),
  bizId: z.string(),
  nextDeductAt: z.string().nullable().optional(),
  lastDeductAt: z.string().nullable().optional(),
  failCount: z.int(),
  totalDeductCount: z.int(),
  lastOrderNo: z.string().nullable().optional(),
  signedAt: z.string().nullable().optional(),
  terminatedAt: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentContract' });

export type PaymentContract = z.infer<typeof paymentContractSchema>;

/** 单期扣款结果 */
export const paymentContractDeductOutcomeSchema = z.object({
  orderNo: z.string().nullable().optional(),
  deductStatus: z.enum(PAYMENT_DEDUCT_RESULT_STATUSES),
  failReason: z.string().nullable().optional(),
}).meta({ id: 'PaymentContractDeductOutcome' });

export type PaymentContractDeductOutcome = z.infer<typeof paymentContractDeductOutcomeSchema>;

/** 手动补扣一期的结果（协议最新状态 + 本期订单号 + 扣款结果） */
export const paymentDeductResultSchema = paymentContractDeductOutcomeSchema.extend({
  contract: paymentContractSchema,
}).meta({ id: 'PaymentDeductResult' });

export type PaymentDeductResult = z.infer<typeof paymentDeductResultSchema>;

/** 管理端签约结果（协议 + 可选的首期扣款结果） */
export const paymentContractSignResultSchema = z.object({
  contract: paymentContractSchema,
  firstDeduct: paymentContractDeductOutcomeSchema.nullable().optional().meta({ description: '签约后立即执行的首期扣款结果' }),
}).meta({ id: 'PaymentContractSignResult' });

export type PaymentContractSignResult = z.infer<typeof paymentContractSignResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentContractListQuery = paginationQuery.extend({
  applicationId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
  status: z.enum(PAYMENT_CONTRACT_STATUSES).optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  planId: z.coerce.number().int().positive().optional(),
  bizType: z.string().optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

/** 签约协议：与扣款计划同挂 `/api/payment` 根，操作名在根内唯一 */
export const paymentSigningContract = defineContract('/api/payment', {
  contracts: op.get('/contracts', { query: paymentContractListQuery, response: paginated(paymentContractSchema), summary: '签约协议列表' }),
  contractDetail: op.get('/contracts/{id}', { params: idParam, query: paymentApplicationQuery, response: paymentContractSchema, summary: '签约协议详情' }),
  createContract: op.post('/contracts', {
    body: createPaymentContractSchema,
    response: paymentContractSignResultSchema,
    summary: '创建签约协议（演示/测试，沙箱即时生效）',
    description: '管理端手工签约，可选签约后立即执行首期扣款；真实渠道需商户开通代扣产品权限。',
  }),
  terminateContract: op.post('/contracts/{id}/terminate', { params: idParam, query: paymentApplicationQuery, response: paymentContractSchema, summary: '解约' }),
  pauseContract: op.post('/contracts/{id}/pause', { params: idParam, query: paymentApplicationQuery, response: paymentContractSchema, summary: '暂停扣款' }),
  resumeContract: op.post('/contracts/{id}/resume', { params: idParam, query: paymentApplicationQuery, response: paymentContractSchema, summary: '恢复扣款（重置失败计数并尽快补扣）' }),
  deductContract: op.post('/contracts/{id}/deduct', {
    params: idParam,
    query: paymentApplicationQuery,
    response: paymentDeductResultSchema,
    summary: '手动补扣一期',
    description: '资金扣款接口，挂幂等防重复提交；并发下由活跃业务单唯一索引兜底。',
  }),
  recoverContract: op.post('/contracts/{id}/recover', {
    params: idParam,
    query: paymentApplicationQuery,
    response: paymentContractSchema,
    summary: '查询并恢复未知协议状态',
    description: '仅当渠道适配器明确声明 contract.query 能力时收敛；否则保持原状态并记录原因。',
  }),
}, { tags: ['支付中心-签约代扣'] });
