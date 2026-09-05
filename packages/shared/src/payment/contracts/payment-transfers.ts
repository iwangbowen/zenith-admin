import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_TRANSFER_APPROVAL_STATUSES, PAYMENT_TRANSFER_STATUSES } from '../constants';
import { approvePaymentTransferSchema, createPaymentTransferSchema, idempotencyKeyHeaders } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentTransferSchema = z.object({
  id: z.int(),
  transferNo: z.string(),
  outTransferNo: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  receiverAccount: z.string(),
  receiverName: z.string().nullable().optional(),
  amount: z.int().meta({ description: '转账金额（分）' }),
  remark: z.string().nullable().optional(),
  status: z.enum(PAYMENT_TRANSFER_STATUSES),
  approvalStatus: z.enum(PAYMENT_TRANSFER_APPROVAL_STATUSES),
  appliedById: z.int().nullable().optional(),
  approverId: z.int().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  approvalRemark: z.string().nullable().optional(),
  channelTransferNo: z.string().nullable().optional(),
  failReason: z.string().nullable().optional(),
  attempts: z.int(),
  fundReservationId: z.int(),
  version: z.int().nonnegative(),
  bizType: z.string().nullable().optional(),
  bizId: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  operatorName: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentTransfer' });

export type PaymentTransfer = z.infer<typeof paymentTransferSchema>;

/** 转账汇总（列表页顶部统计） */
export const paymentTransferSummarySchema = z.object({
  totalAmount: z.int().meta({ description: '成功转账金额合计（分）' }),
  successCount: z.int(),
  processingCount: z.int().meta({ description: '处理中 + 结果待确认笔数' }),
  failedCount: z.int(),
}).meta({ id: 'PaymentTransferSummary' });

export type PaymentTransferSummary = z.infer<typeof paymentTransferSummarySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentTransferListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: z.enum(PAYMENT_TRANSFER_STATUSES).optional(),
  approvalStatus: z.enum(PAYMENT_TRANSFER_APPROVAL_STATUSES).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const paymentTransferSummaryQuery = z.object({
  channel: z.enum(PAYMENT_CHANNELS).optional(),
});

export const paymentTransferContract = defineContract('/api/payment/transfers', {
  list: op.get('/', { query: paymentTransferListQuery, response: paginated(paymentTransferSchema), summary: '转账单列表' }),
  summary: op.get('/summary', { query: paymentTransferSummaryQuery, response: paymentTransferSummarySchema, summary: '转账汇总（成功金额/各状态笔数）' }),
  detail: op.get('/{id}', { params: idParam, response: paymentTransferSchema, summary: '转账单详情' }),
  create: op.post('/', {
    headers: idempotencyKeyHeaders,
    body: createPaymentTransferSchema,
    response: paymentTransferSchema,
    summary: '发起转账（微信零钱 / 支付宝账户）',
    description: '低于审批阈值时落单后同步调渠道执行；达到阈值时仅冻结资金并等待四眼审批，审批前不会调用渠道。资金流出接口，使用业务幂等键防止重复提交。',
  }),
  approve: op.post('/{id}/approve', {
    params: idParam,
    body: approvePaymentTransferSchema,
    response: paymentTransferSchema,
    summary: '审批通过待审批转账',
    description: '申请人与审批人必须为不同用户。审批状态通过 CAS 抢占，只有审批成功的一方会触发渠道转账。',
  }),
  reject: op.post('/{id}/reject', {
    params: idParam,
    body: approvePaymentTransferSchema,
    response: paymentTransferSchema,
    summary: '驳回待审批转账',
    description: '驳回转账并在同一事务内释放对应的资金预占。',
  }),
  query: op.post('/{id}/query', { params: idParam, response: paymentTransferSchema, summary: '主动查询渠道转账结果并同步本地状态' }),
}, { tags: ['支付中心-转账'] });
