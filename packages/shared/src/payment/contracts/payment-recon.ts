import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PAYMENT_CHANNELS,
  PAYMENT_RECON_HANDLE_STATUSES,
  PAYMENT_RECON_RESULTS,
  PAYMENT_RECON_SOURCES,
  PAYMENT_RECON_STATUSES,
} from '../constants';
import { autoPaymentReconSchema, createPaymentReconBatchSchema, handlePaymentReconItemSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentReconBatchSchema = z.object({
  id: z.int(),
  batchNo: z.string(),
  channel: z.enum(PAYMENT_CHANNELS),
  appId: z.int(),
  channelConfigId: z.int(),
  currency: z.string(),
  billDate: z.string().meta({ description: '账单日期 YYYY-MM-DD' }),
  source: z.enum(PAYMENT_RECON_SOURCES),
  status: z.enum(PAYMENT_RECON_STATUSES),
  localCount: z.int(),
  localAmount: z.int(),
  channelCount: z.int(),
  channelAmount: z.int(),
  matchedCount: z.int(),
  diffCount: z.int(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PaymentReconBatch' });

export type PaymentReconBatch = z.infer<typeof paymentReconBatchSchema>;

export const paymentReconItemSchema = z.object({
  id: z.int(),
  batchId: z.int(),
  orderNo: z.string().nullable().optional(),
  channelTradeNo: z.string().nullable().optional(),
  localAmount: z.int().nullable().optional(),
  channelAmount: z.int().nullable().optional(),
  localStatus: z.string().nullable().optional(),
  channelStatus: z.string().nullable().optional(),
  result: z.enum(PAYMENT_RECON_RESULTS),
  handleStatus: z.enum(PAYMENT_RECON_HANDLE_STATUSES).nullable().optional().meta({ description: '差异处理状态：null=无需处理（一致项）' }),
  handleRemark: z.string().nullable().optional(),
  handledAt: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'PaymentReconItem' });

export type PaymentReconItem = z.infer<typeof paymentReconItemSchema>;

export const paymentReconSampleBillSchema = z.object({
  billText: z.string().meta({ description: 'CSV 渠道账单文本' }),
}).meta({ id: 'PaymentReconSampleBill' });

export type PaymentReconSampleBill = z.infer<typeof paymentReconSampleBillSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentReconBatchListQuery = paginationQuery.extend({
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  status: z.enum(PAYMENT_RECON_STATUSES).optional(),
});

export const paymentReconItemListQuery = paginationQuery.extend({
  result: z.enum(PAYMENT_RECON_RESULTS).optional(),
  handleStatus: z.enum(PAYMENT_RECON_HANDLE_STATUSES).optional(),
});

export const paymentReconSampleBillQuery = z.object({
  applicationId: z.coerce.number().int().positive(),
  channel: z.enum(PAYMENT_CHANNELS),
  channelConfigId: z.coerce.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('CNY'),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '账单日期须为 YYYY-MM-DD'),
});

/** 对账批次是本组的主资源：list / detail / create / remove 均指批次 */
export const paymentReconContract = defineContract('/api/payment/recon', {
  list: op.get('/batches', { query: paymentReconBatchListQuery, response: paginated(paymentReconBatchSchema), summary: '对账批次列表' }),
  create: op.post('/batches', { body: createPaymentReconBatchSchema, response: paymentReconBatchSchema, summary: '创建对账批次（上传渠道账单逐笔比对）' }),
  sampleBill: op.get('/sample-bill', {
    query: paymentReconSampleBillQuery,
    response: paymentReconSampleBillSchema,
    summary: '生成模拟渠道账单（演示/模板）',
    description: '基于本地订单生成一份 CSV 渠道账单，用于演示对账或作为账单格式模板。',
  }),
  auto: op.post('/auto', {
    body: autoPaymentReconSchema,
    response: paymentReconBatchSchema,
    summary: '自动拉取渠道账单并对账',
    description: '沙箱渠道用本地订单生成模拟账单（演示闭环）；生产渠道调用渠道账单下载 API（微信交易账单；支付宝暂不支持需手动上传）。',
  }),
  detail: op.get('/batches/{id}', { params: idParam, response: paymentReconBatchSchema, summary: '对账批次详情' }),
  items: op.get('/batches/{id}/items', { params: idParam, query: paymentReconItemListQuery, response: paginated(paymentReconItemSchema), summary: '对账明细（可按差异类型筛选）' }),
  handleItem: op.patch('/items/{id}/handle', {
    params: idParam,
    body: handlePaymentReconItemSchema,
    response: paymentReconItemSchema,
    summary: '处理对账差异（调账/挂账/忽略）',
    description: '将待处理差异流转为已调账/挂账/已忽略；处理原因必填。仅由真实渠道适配器下载的账单允许选择「已调账」并原子写入双分录凭证，人工上传和沙箱模拟账单只能挂账或忽略。',
  }),
  remove: op.delete('/batches/{id}', { params: idParam, summary: '删除对账批次' }),
}, { tags: ['支付中心-对账'] });
