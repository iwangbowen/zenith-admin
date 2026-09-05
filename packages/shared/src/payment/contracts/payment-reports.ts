import * as z from 'zod';
import { dateRangeBound, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_REPORT_GROUP_BYS } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const paymentReportRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  gross: z.int().meta({ description: '成功收款总额（分）' }),
  fee: z.int().meta({ description: '手续费总额（分）' }),
  refund: z.int().meta({ description: '退款总额（分）' }),
  sharing: z.int().meta({ description: '分账支出总额（分）' }),
  net: z.int().meta({ description: '净额（分）= 收款 - 手续费 - 退款 - 分账' }),
  count: z.int(),
}).meta({ id: 'PaymentReportRow' });

export type PaymentReportRow = z.infer<typeof paymentReportRowSchema>;

export const paymentReportTotalsSchema = z.object({
  totalGross: z.int(),
  totalFee: z.int(),
  totalRefund: z.int(),
  totalSharing: z.int().meta({ description: '净分账支出（分账减分账冲正，分）' }),
  totalNet: z.int(),
  totalCount: z.int(),
}).meta({ id: 'PaymentReportTotals' });

export type PaymentReportTotals = z.infer<typeof paymentReportTotalsSchema>;

/** 环比周期：汇总 + 逐行（按 key 对齐做行级环比） */
export const paymentReportPeriodSchema = paymentReportTotalsSchema.extend({
  rows: z.array(paymentReportRowSchema),
}).meta({ id: 'PaymentReportPeriod' });

export type PaymentReportPeriod = z.infer<typeof paymentReportPeriodSchema>;

export const paymentReportSummarySchema = paymentReportTotalsSchema.extend({
  groupBy: z.enum(PAYMENT_REPORT_GROUP_BYS),
  rows: z.array(paymentReportRowSchema),
  prev: paymentReportPeriodSchema.nullable().optional().meta({ description: '环比周期（compare=true 且提供时间范围时返回）' }),
}).meta({ id: 'PaymentReportSummary' });

export type PaymentReportSummary = z.infer<typeof paymentReportSummarySchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const paymentReportSummaryQuery = z.object({
  groupBy: z.enum(PAYMENT_REPORT_GROUP_BYS).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
  compare: queryBool('环比：附带上一等长周期汇总（需提供时间范围）'),
});

export const paymentReportContract = defineContract('/api/payment/reports', {
  summary: op.get('/summary', { query: paymentReportSummaryQuery, response: paymentReportSummarySchema, summary: '财务报表汇总（按日/应用/商户账户/币种/渠道）' }),
}, { tags: ['支付中心-财务报表'] });
