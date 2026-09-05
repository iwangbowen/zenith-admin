import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

const channelBucketSchema = z.object({ channel: z.string(), count: z.number(), amount: z.number() });
const statusBucketSchema = z.object({ status: z.string(), count: z.number() });
const payMethodBucketSchema = z.object({ payMethod: z.string(), count: z.number(), amount: z.number() });
const bizTypeBucketSchema = z.object({ bizType: z.string(), count: z.number(), amount: z.number() });

/** 支付统计概览（金额单位：分） */
export const paymentStatsSchema = z.object({
  totalAmount: z.number().meta({ description: '累计成功金额（分）' }),
  todayAmount: z.number().meta({ description: '今日成功金额（分）' }),
  todayCount: z.number().meta({ description: '今日成功订单数' }),
  orderCount: z.number().meta({ description: '订单总数' }),
  successCount: z.number().meta({ description: '成功订单数（含退款中 / 已退款）' }),
  refundAmount: z.number().meta({ description: '累计退款金额（分）' }),
  refundCount: z.number().meta({ description: '成功退款笔数' }),
  successRate: z.number().meta({ description: '支付成功率（0-100，保留 1 位小数）' }),
  refundRate: z.number().meta({ description: '退款率（退款金额 / 成功金额，0-100）' }),
  avgAmount: z.number().meta({ description: '成功订单笔均金额（分）' }),
  byChannel: z.array(channelBucketSchema),
  byStatus: z.array(statusBucketSchema),
  byPayMethod: z.array(payMethodBucketSchema).meta({ description: '按支付方式分布（count=全部订单数，amount=成功口径金额）' }),
  byBizType: z.array(bizTypeBucketSchema).meta({ description: '按业务类型成功金额 TOP 10' }),
}).meta({ id: 'PaymentStats' });

export type PaymentStats = z.infer<typeof paymentStatsSchema>;

/** 收款趋势单点（按天） */
export const paymentTrendPointSchema = z.object({
  date: z.string().meta({ description: '日期 YYYY-MM-DD' }),
  amount: z.number().meta({ description: '当日成功金额（分）' }),
  count: z.number().meta({ description: '当日成功订单数' }),
  refundAmount: z.number().meta({ description: '当日退款金额（分）' }),
}).meta({ id: 'PaymentTrendPoint' });

export type PaymentTrendPoint = z.infer<typeof paymentTrendPointSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentTrendQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30).meta({ description: '统计天数' }),
});

/** 统计概览与趋势：共用 `/api/payment` 根 */
export const paymentStatsContract = defineContract('/api/payment', {
  stats: op.get('/stats', { response: paymentStatsSchema, summary: '支付统计概览' }),
  trend: op.get('/trend', { query: paymentTrendQuery, response: z.array(paymentTrendPointSchema), summary: '收款趋势（近 N 天）' }),
}, { tags: ['支付中心'] });
