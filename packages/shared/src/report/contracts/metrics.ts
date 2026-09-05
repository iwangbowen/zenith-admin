import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_METRIC_LIFECYCLE_STATUSES, REPORT_METRIC_TYPES } from '../types';
import {
  createReportMetricSchema,
  reportMetricEvaluateSchema,
  reportMetricLifecycleActionSchema,
  reportMetricLifecycleStatusSchema,
  reportMetricTypeSchema,
  updateReportMetricSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportMetricSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  folderId: z.int().nullable(),
  folderName: z.string().nullable().optional(),
  ownerId: z.int().nullable(),
  ownerName: z.string().nullable().optional(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: z.enum(REPORT_METRIC_TYPES),
  datasetId: z.int(),
  datasetName: z.string().nullable().optional(),
  sourceField: z.string().nullable().optional(),
  formula: z.string().nullable().optional(),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'distinct_count']).nullable().optional(),
  dimensions: z.array(z.string()),
  timeField: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  caliber: z.string().nullable().optional(),
  lifecycleStatus: z.enum(REPORT_METRIC_LIFECYCLE_STATUSES),
  revision: z.int(),
  publishedSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  publishedBy: z.int().nullable().optional(),
  deprecatedAt: z.string().nullable().optional(),
  deprecatedBy: z.int().nullable().optional(),
  deprecationReason: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportMetric' });

export type ReportMetric = z.infer<typeof reportMetricSchema>;

export const reportMetricEvaluationSchema = z.object({
  metricId: z.int(),
  code: z.string(),
  value: z.number(),
  formattedValue: z.string(),
  unit: z.string().nullable().optional(),
  durationMs: z.int(),
  cacheHit: z.boolean(),
}).meta({ id: 'ReportMetricEvaluation' });

export type ReportMetricEvaluation = z.infer<typeof reportMetricEvaluationSchema>;

export const reportMetricRefsSchema = z.object({
  dashboards: z.array(z.object({ id: z.int(), name: z.string(), widgets: z.array(z.string()) })),
  alerts: z.array(z.object({ id: z.int(), name: z.string() })),
  metrics: z.array(z.object({ id: z.int(), code: z.string(), name: z.string() })),
}).meta({ id: 'ReportMetricRefs' });

export type ReportMetricRefs = z.infer<typeof reportMetricRefsSchema>;

export const reportMetricLookupOptionSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string(),
  status: z.enum(REPORT_METRIC_LIFECYCLE_STATUSES),
  datasetId: z.int(),
  type: z.literal('metric'),
}).meta({ id: 'ReportMetricLookup' });

export type ReportMetricLookupOption = z.infer<typeof reportMetricLookupOptionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportMetricListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  datasetId: z.coerce.number().int().positive().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  type: reportMetricTypeSchema.optional(),
  status: reportMetricLifecycleStatusSchema.optional(),
});

export const reportMetricLookupQuery = z.object({
  keyword: z.string().optional(),
  status: reportMetricLifecycleStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const reportMetricContract = defineContract('/api/report/metrics', {
  list: op.get('/', { query: reportMetricListQuery, response: paginated(reportMetricSchema), summary: '指标列表' }),
  lookup: op.get('/lookup', { query: reportMetricLookupQuery, response: z.array(reportMetricLookupOptionSchema), summary: '指标下拉' }),
  detail: op.get('/{id}', { params: idParam, response: reportMetricSchema, summary: '指标详情' }),
  create: op.post('/', { body: createReportMetricSchema, response: reportMetricSchema, summary: '创建指标' }),
  update: op.put('/{id}', { params: idParam, body: updateReportMetricSchema, response: reportMetricSchema, summary: '更新指标' }),
  evaluate: op.post('/{id}/evaluate', { params: idParam, body: reportMetricEvaluateSchema, response: reportMetricEvaluationSchema, summary: '计算指标' }),
  publish: op.post('/{id}/publish', { params: idParam, body: reportMetricLifecycleActionSchema, response: reportMetricSchema, summary: '直接发布指标' }),
  deprecate: op.post('/{id}/deprecate', { params: idParam, body: reportMetricLifecycleActionSchema, response: reportMetricSchema, summary: '废弃指标' }),
  refs: op.get('/{id}/refs', { params: idParam, response: reportMetricRefsSchema, summary: '指标引用' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除指标' }),
}, { tags: ['报表指标'] });
