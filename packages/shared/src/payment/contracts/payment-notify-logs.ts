import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentNotifyLogSchema = z.object({
  id: z.int(),
  channel: z.enum(PAYMENT_CHANNELS),
  channelConfigId: z.int(),
  appId: z.int().nullable().optional(),
  providerEventId: z.string().nullable().optional(),
  scene: z.string(),
  orderNo: z.string().nullable().optional(),
  signatureValid: z.boolean(),
  merchantId: z.string().nullable().optional(),
  providerAppId: z.string().nullable().optional(),
  paidAmount: z.int().nullable().optional(),
  currency: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  rawBody: z.string().nullable().optional().meta({ description: '原始回调 body（最多 8000 字节），用于排查验签 / 对账争议' }),
  headers: z.string().nullable().optional().meta({ description: '回调请求头（JSON 字符串），用于排查验签 / 来源' }),
  createdAt: z.string(),
}).meta({ id: 'PaymentNotifyLog' });

export type PaymentNotifyLog = z.infer<typeof paymentNotifyLogSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentNotifyLogListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  scene: z.enum(['payment', 'refund']).optional(),
  signatureValid: queryBool('只看验签通过 / 失败的回调'),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

/** 渠道回调日志：共用 `/api/payment` 根 */
export const paymentNotifyLogContract = defineContract('/api/payment', {
  logs: op.get('/logs', { query: paymentNotifyLogListQuery, response: paginated(paymentNotifyLogSchema), summary: '支付回调日志' }),
}, { tags: ['支付中心'] });
