import * as z from 'zod';
import { entityStatusSchema } from '../../core/api-schemas';
import {
  REPORT_ALERT_AGGREGATES,
  REPORT_ALERT_OPS,
  REPORT_DELIVERY_STATUSES,
  REPORT_DELIVERY_TARGET_TYPES,
  REPORT_DELIVERY_TRIGGER_TYPES,
  REPORT_NOTIFY_CHANNELS,
  REPORT_SCHEDULE_MISFIRE_POLICIES,
  REPORT_SORT_ORDERS,
} from '../constants';
import { REPORT_DATASOURCE_TYPES } from '../types';
import {
  reportComputedFieldSchema,
  reportDatasetParamSchema,
  reportFieldFormatSchema,
  reportFieldSchema,
} from '../validation';

/**
 * 报表域各资源契约共用的积木：枚举 schema、精简下拉项、字段 / 参数定义与取数结果。
 * 字段 / 参数 / 计算字段的形状与请求校验完全一致，直接复用 validation 中的 schema。
 */

// ─── 枚举 ────────────────────────────────────────────────────────────────────

export const reportSortOrderSchema = z.enum(REPORT_SORT_ORDERS);
export const reportNotifyChannelEnum = z.enum(REPORT_NOTIFY_CHANNELS);
export const reportMisfirePolicyEnum = z.enum(REPORT_SCHEDULE_MISFIRE_POLICIES);
export const reportDeliveryStatusSchema = z.enum(REPORT_DELIVERY_STATUSES);
export const reportDeliveryTriggerTypeSchema = z.enum(REPORT_DELIVERY_TRIGGER_TYPES);
export const reportDeliveryTargetTypeSchema = z.enum(REPORT_DELIVERY_TARGET_TYPES);
export const reportAlertOpSchema = z.enum(REPORT_ALERT_OPS);
export const reportAlertAggregateSchema = z.enum(REPORT_ALERT_AGGREGATES);

/** 启用 / 禁用状态（与 core 的通用状态一致） */
export const reportStatusSchema = entityStatusSchema;

/** 查询串布尔（仅接受 'true' / 'false' 字面量；缺省 = 不过滤） */
export const strictQueryBool = z.enum(['true', 'false']).transform((value) => value === 'true').optional();

// ─── 字段 / 参数定义（与请求校验同源） ──────────────────────────────────────────

export type ReportFieldFormat = z.infer<typeof reportFieldFormatSchema>;
export type ReportField = z.infer<typeof reportFieldSchema>;
export type ReportComputedField = z.infer<typeof reportComputedFieldSchema>;
export type ReportDatasetParam = z.infer<typeof reportDatasetParamSchema>;

/** 取数结果列：声明列 / 计算列 / 推断列 */
export const reportResultFieldSchema = reportFieldSchema.extend({
  source: z.enum(['declared', 'computed', 'inferred']).optional(),
}).meta({ id: 'ReportResultField' });

export type ReportResultField = z.infer<typeof reportResultFieldSchema>;

// ─── 精简下拉项 ─────────────────────────────────────────────────────────────

export const reportLookupOptionSchema = z.object({
  id: z.int(),
  name: z.string(),
  status: reportStatusSchema.nullable().optional(),
  type: z.enum(REPORT_DATASOURCE_TYPES).nullable().optional(),
  categoryId: z.int().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  datasourceId: z.int().nullable().optional(),
  datasourceName: z.string().nullable().optional(),
  dashboardCount: z.int().optional(),
}).meta({ id: 'ReportLookupOption' });

export type ReportLookupOption = z.infer<typeof reportLookupOptionSchema>;

// ─── 取数结果 ───────────────────────────────────────────────────────────────

export const reportDataResultSchema = z.object({
  columns: z.array(z.string()),
  fields: z.array(reportResultFieldSchema),
  rows: z.array(z.record(z.string(), z.unknown())).meta({ description: '数据行；键为列名' }),
  total: z.number().nullable().optional(),
  bytes: z.int().nullable().optional(),
  truncated: z.boolean().optional(),
  truncatedReason: z.string().nullable().optional(),
  quotaRemaining: z.number().nullable().optional(),
  costUnits: z.number().nullable().optional(),
  queueDurationMs: z.int().nullable().optional(),
}).meta({ id: 'ReportDataResult' });

export type ReportDataResult = z.infer<typeof reportDataResultSchema>;

export const reportWidgetDataErrorSchema = z.object({
  code: z.int(),
  message: z.string(),
}).meta({ id: 'ReportWidgetDataError' });

export type ReportWidgetDataError = z.infer<typeof reportWidgetDataErrorSchema>;

export const reportWidgetDataResultSchema = z.object({
  data: reportDataResultSchema.nullable(),
  error: reportWidgetDataErrorSchema.nullable(),
  durationMs: z.int(),
  cacheHit: z.boolean(),
}).meta({ id: 'ReportDashboardWidgetData' });

export type ReportWidgetDataResult = z.infer<typeof reportWidgetDataResultSchema>;

/** 仪表盘批量取数结果：`{ [widgetId]: { data, error, durationMs, cacheHit } }` */
export const reportDashboardDataSchema = z.record(z.string(), reportWidgetDataResultSchema).meta({ id: 'ReportDashboardData' });

export type ReportDashboardData = z.infer<typeof reportDashboardDataSchema>;
