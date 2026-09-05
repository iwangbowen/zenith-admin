import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { ANALYTICS_EXPERIMENT_STATUSES } from '../constants';
import { analyticsExperimentVariantSchema, createAnalyticsExperimentSchema, updateAnalyticsExperimentSchema } from '../validation';
import { dateOnly, siteKeyQueryField } from './_query';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const analyticsExperimentSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  tenantName: z.string().nullable(),
  expKey: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(ANALYTICS_EXPERIMENT_STATUSES),
  trafficAllocation: z.int().meta({ description: '进入实验的流量百分比（0-100）' }),
  variants: z.array(analyticsExperimentVariantSchema).meta({ description: '变体列表；首项为对照组' }),
  metricEventName: z.string(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AnalyticsExperiment' });

export type AnalyticsExperiment = z.infer<typeof analyticsExperimentSchema>;

/** 分流结果（SDK getVariant） */
export const analyticsExperimentAssignmentSchema = z.object({
  expKey: z.string(),
  variantKey: z.string(),
}).meta({ id: 'AnalyticsExperimentAssignment' });

export type AnalyticsExperimentAssignment = z.infer<typeof analyticsExperimentAssignmentSchema>;

export const analyticsExperimentReportVariantSchema = z.object({
  variantKey: z.string(),
  exposures: z.int(),
  conversions: z.int(),
  conversionRate: z.number(),
  isControl: z.boolean().meta({ description: '是否为对照组（变体列表首项）；对照组的所有对比字段均为 null' }),
  absoluteUplift: z.number().nullable().meta({ description: '相对对照组的绝对提升（百分点）' }),
  relativeUplift: z.number().nullable().meta({ description: '相对对照组的相对提升（%）' }),
  pValue: z.number().nullable().meta({ description: '双比例 Z 检验双尾 p 值' }),
  confidenceLow: z.number().nullable().meta({ description: '绝对提升的 95% 置信区间下界（百分点）' }),
  confidenceHigh: z.number().nullable(),
  significant: z.boolean().meta({ description: 'p < 0.05 且正态近似成立时才为 true' }),
  normalApproxValid: z.boolean().meta({ description: '正态近似是否成立（各组成功/失败数均 >= 5）；false 时 p 值不可信' }),
}).meta({ id: 'AnalyticsExperimentReportVariant' });

export type AnalyticsExperimentReportVariant = z.infer<typeof analyticsExperimentReportVariantSchema>;

/** 样本比例失衡检验：命中表示分流异常，转化率对比不可信 */
export const analyticsExperimentSrmSchema = z.object({
  chiSquare: z.number(),
  pValue: z.number(),
  mismatch: z.boolean(),
}).meta({ id: 'AnalyticsExperimentSrm' });

export type AnalyticsExperimentSrm = z.infer<typeof analyticsExperimentSrmSchema>;

export const analyticsExperimentReportSchema = z.object({
  experimentId: z.int(),
  expKey: z.string(),
  metricEventName: z.string(),
  variants: z.array(analyticsExperimentReportVariantSchema),
  totalExposures: z.int(),
  srm: analyticsExperimentSrmSchema.nullable(),
  requiredSamplePerVariant: z.int().nullable().meta({ description: '检测 10% 相对提升、80% 功效所需的每组曝光量（基于对照组当前转化率）' }),
}).meta({ id: 'AnalyticsExperimentReport' });

export type AnalyticsExperimentReport = z.infer<typeof analyticsExperimentReportSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const analyticsExperimentListQuery = paginationQuery.extend({
  name: z.string().optional(),
  status: queryEnum(ANALYTICS_EXPERIMENT_STATUSES),
});

export const analyticsExperimentReportQuery = z.object({
  startDate: dateOnly.optional(),
  endDate: dateOnly.optional(),
});

export const analyticsExperimentAssignmentsQuery = z.object({
  siteKey: siteKeyQueryField,
  keys: z.string().optional().meta({ description: '逗号分隔的实验 key 列表；留空返回全部运行中实验' }),
  distinctId: z.string().max(64).optional().meta({ description: '匿名访客标识；登录态下忽略' }),
});

export const analyticsExperimentContract = defineContract('/api/analytics', {
  assignments: op.get('/experiments/assignments', {
    query: analyticsExperimentAssignmentsQuery,
    response: z.array(analyticsExperimentAssignmentSchema),
    public: true,
    summary: '公开获取 A/B 实验分流结果',
  }),
  experiments: op.get('/experiments', { query: analyticsExperimentListQuery, response: paginated(analyticsExperimentSchema), summary: 'A/B 实验列表' }),
  experimentDetail: op.get('/experiments/{id}', { params: idParam, response: analyticsExperimentSchema, summary: 'A/B 实验详情' }),
  createExperiment: op.post('/experiments', { body: createAnalyticsExperimentSchema, response: analyticsExperimentSchema, summary: '创建 A/B 实验' }),
  updateExperiment: op.put('/experiments/{id}', { params: idParam, body: updateAnalyticsExperimentSchema, response: analyticsExperimentSchema, summary: '更新 A/B 实验' }),
  removeExperiment: op.delete('/experiments/{id}', { params: idParam, summary: '删除 A/B 实验' }),
  startExperiment: op.post('/experiments/{id}/start', { params: idParam, response: analyticsExperimentSchema, summary: '启动 A/B 实验' }),
  pauseExperiment: op.post('/experiments/{id}/pause', { params: idParam, response: analyticsExperimentSchema, summary: '暂停 A/B 实验' }),
  completeExperiment: op.post('/experiments/{id}/complete', { params: idParam, response: analyticsExperimentSchema, summary: '完成 A/B 实验' }),
  experimentReport: op.get('/experiments/{id}/report', { params: idParam, query: analyticsExperimentReportQuery, response: analyticsExperimentReportSchema, summary: 'A/B 实验报告' }),
}, { tags: ['Analytics'] });
