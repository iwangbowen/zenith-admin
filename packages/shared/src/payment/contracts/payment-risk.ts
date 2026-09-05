import * as z from 'zod';
import { dateRangeBound, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CHANNELS,
  PAYMENT_RISK_ACTIONS,
  PAYMENT_RISK_DIMENSIONS,
  PAYMENT_RISK_HIT_QUERY_DIMENSIONS,
  PAYMENT_RISK_REVIEW_STATUSES,
  PAYMENT_RISK_SCOPES,
} from '../constants';
import { createPaymentRiskRuleSchema, handlePaymentRiskReviewSchema, updatePaymentRiskRuleSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentRiskRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  scope: z.enum(PAYMENT_RISK_SCOPES),
  channel: z.enum(PAYMENT_CHANNELS).nullable().optional(),
  bizType: z.string().nullable().optional(),
  singleLimit: z.int().nullable().optional().meta({ description: '单笔限额（分）' }),
  dailyLimit: z.int().nullable().optional().meta({ description: '当日累计限额（分）' }),
  dailyCountLimit: z.int().nullable().optional(),
  blockListKeys: z.array(z.string()).meta({ description: '引用的黑名单库 key（规则中心名单库，type=black/grey），任一名单命中任一主体标识即触发动作' }),
  allowListKeys: z.array(z.string()).meta({ description: '引用的白名单库 key（type=white），任一命中则跳过本规则全部检查' }),
  action: z.enum(PAYMENT_RISK_ACTIONS).meta({ description: '命中动作：block=直接拦截，review=挂起人工审核' }),
  status: entityStatusSchema,
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentRiskRule' });

export type PaymentRiskRule = z.infer<typeof paymentRiskRuleSchema>;

/** 风控命中留痕 */
export const paymentRiskHitSchema = z.object({
  id: z.int(),
  ruleId: z.int().nullable().optional(),
  ruleName: z.string(),
  action: z.enum(PAYMENT_RISK_ACTIONS),
  dimension: z.enum(PAYMENT_RISK_DIMENSIONS),
  dimensionValue: z.string().nullable().optional(),
  channel: z.enum(PAYMENT_CHANNELS),
  bizType: z.string(),
  bizId: z.string(),
  orderNo: z.string().nullable().optional(),
  amount: z.int().meta({ description: '交易金额（分）' }),
  openId: z.string().nullable().optional(),
  userId: z.int().nullable().optional(),
  clientIp: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'PaymentRiskHit' });

export type PaymentRiskHit = z.infer<typeof paymentRiskHitSchema>;

/** 人工审核单（review 动作挂起的可疑交易） */
export const paymentRiskReviewSchema = z.object({
  id: z.int(),
  reviewNo: z.string(),
  hitId: z.int().nullable().optional(),
  orderNo: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  appId: z.int(),
  bizType: z.string(),
  bizId: z.string(),
  amount: z.int().meta({ description: '交易金额（分）' }),
  currency: z.string(),
  reason: z.string(),
  status: z.enum(PAYMENT_RISK_REVIEW_STATUSES),
  reviewerName: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  reviewRemark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentRiskReview' });

export type PaymentRiskReview = z.infer<typeof paymentRiskReviewSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentRiskRuleListQuery = paginationQuery.extend({
  scope: z.enum(PAYMENT_RISK_SCOPES).optional(),
  status: entityStatusSchema.optional(),
});

export const paymentRiskRuleContract = defineContract('/api/payment/risk-rules', {
  list: op.get('/', { query: paymentRiskRuleListQuery, response: paginated(paymentRiskRuleSchema), summary: '风控规则列表' }),
  detail: op.get('/{id}', { params: idParam, response: paymentRiskRuleSchema, summary: '风控规则详情' }),
  create: op.post('/', { body: createPaymentRiskRuleSchema, response: paymentRiskRuleSchema, summary: '新增风控规则' }),
  update: op.put('/{id}', { params: idParam, body: updatePaymentRiskRuleSchema, response: paymentRiskRuleSchema, summary: '编辑风控规则' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除风控规则' }),
}, { tags: ['支付中心-风控'] });

export const paymentRiskHitListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  action: z.enum(PAYMENT_RISK_ACTIONS).optional(),
  dimension: z.enum(PAYMENT_RISK_HIT_QUERY_DIMENSIONS).optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const paymentRiskReviewListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(PAYMENT_RISK_REVIEW_STATUSES).optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
});

/** 风控运营：拦截 / 命中留痕与人工审核队列 */
export const paymentRiskOpsContract = defineContract('/api/payment/risk', {
  hits: op.get('/hits', { query: paymentRiskHitListQuery, response: paginated(paymentRiskHitSchema), summary: '风控命中/拦截记录' }),
  reviews: op.get('/reviews', { query: paymentRiskReviewListQuery, response: paginated(paymentRiskReviewSchema), summary: '人工审核队列' }),
  approveReview: op.post('/reviews/{id}/approve', { params: idParam, body: handlePaymentRiskReviewSchema, response: paymentRiskReviewSchema, summary: '审核放行（挂起订单可继续支付）' }),
  rejectReview: op.post('/reviews/{id}/reject', { params: idParam, body: handlePaymentRiskReviewSchema, response: paymentRiskReviewSchema, summary: '审核拒绝（关闭挂起订单）' }),
}, { tags: ['支付中心-风控'] });
