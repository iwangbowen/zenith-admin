import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_QUOTA_SCOPES } from '../types';
import { createReportQueryQuotaSchema, resetReportQueryQuotaSchema, updateReportQueryQuotaSchema } from '../validation';
import { strictQueryBool } from './_common';
import { reportQueryCapacitySchema, reportQueryCostTrendPointSchema } from './executions';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportQueryQuotaSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  scope: z.enum(REPORT_QUOTA_SCOPES),
  userId: z.int().nullable().optional(),
  maxConcurrent: z.int(),
  dailyQueryLimit: z.int(),
  dailyRowLimit: z.int(),
  dailyByteLimit: z.int(),
  dailyCostLimit: z.number(),
  resetTimezone: z.string(),
  enabled: z.boolean(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportQueryQuota' });

export type ReportQueryQuota = z.infer<typeof reportQueryQuotaSchema>;

export const reportQueryQuotaUsageSchema = z.object({
  tenantId: z.int().nullable(),
  userId: z.int().nullable(),
  timezone: z.string(),
  day: z.string(),
  concurrent: z.int(),
  queries: z.int(),
  rows: z.int(),
  bytes: z.int(),
  costUnits: z.number(),
  maxConcurrent: z.int(),
  dailyQueryLimit: z.int(),
  dailyRowLimit: z.int(),
  dailyByteLimit: z.int(),
  dailyCostLimit: z.number(),
}).meta({ id: 'ReportQueryQuotaUsage' });

export type ReportQueryQuotaUsage = z.infer<typeof reportQueryQuotaUsageSchema>;

export const reportQueryCostLogSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  userId: z.int().nullable().optional(),
  datasetId: z.int().nullable().optional(),
  datasourceId: z.int().nullable().optional(),
  scene: z.string(),
  requestId: z.string(),
  queuedMs: z.int(),
  durationMs: z.int(),
  rowCount: z.int(),
  byteSize: z.int(),
  costUnits: z.number(),
  cacheHit: z.boolean(),
  success: z.boolean(),
  errorCode: z.string().nullable().optional(),
  occurredAt: z.string(),
}).meta({ id: 'ReportQueryCostLog' });

export type ReportQueryCostLog = z.infer<typeof reportQueryCostLogSchema>;

export const reportQueryCostStatsSchema = z.object({
  queries: z.int(),
  rows: z.int(),
  bytes: z.int(),
  costUnits: z.number(),
  avgDurationMs: z.int(),
  failures: z.int(),
  capacity: reportQueryCapacitySchema,
}).meta({ id: 'ReportQueryCostStats' });

export type ReportQueryCostStats = z.infer<typeof reportQueryCostStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

const rangeQueryFields = {
  datasetId: z.coerce.number().int().positive().optional(),
  datasourceId: z.coerce.number().int().positive().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
};

export const reportQueryCostRangeQuery = z.object(rangeQueryFields);

export const reportQueryCostTrendQuery = z.object({
  ...rangeQueryFields,
  bucket: z.enum(['hour', 'day']).default('day'),
});

export const reportQueryCostLogListQuery = paginationQuery.extend({
  userId: z.coerce.number().int().positive().optional(),
  datasetId: z.coerce.number().int().positive().optional(),
  datasourceId: z.coerce.number().int().positive().optional(),
  scene: z.string().max(64).optional(),
  success: strictQueryBool,
  start: z.string().optional(),
  end: z.string().optional(),
});

export const reportQuotaUsageQuery = z.object({
  scopeDate: z.string().date().optional().meta({ description: '统计日（YYYY-MM-DD），缺省为当日' }),
});

export const reportQueryCapacityContract = defineContract('/api/report/query-capacity', {
  quotas: op.get('/quotas', { query: paginationQuery, response: paginated(reportQueryQuotaSchema), summary: '查询配额列表' }),
  quotaDetail: op.get('/quotas/{id}', { params: idParam, response: reportQueryQuotaSchema, summary: '查询配额详情' }),
  createQuota: op.post('/quotas', { body: createReportQueryQuotaSchema, response: reportQueryQuotaSchema, summary: '创建查询配额' }),
  updateQuota: op.put('/quotas/{id}', { params: idParam, body: updateReportQueryQuotaSchema, response: reportQueryQuotaSchema, summary: '更新查询配额' }),
  removeQuota: op.delete('/quotas/{id}', { params: idParam, summary: '删除查询配额' }),
  quotaUsage: op.get('/quotas/{id}/usage', { params: idParam, query: reportQuotaUsageQuery, response: reportQueryQuotaUsageSchema, summary: '查询配额用量' }),
  resetQuota: op.post('/quotas/{id}/reset', { params: idParam, body: resetReportQueryQuotaSchema, summary: '重置查询配额用量' }),
  costLogs: op.get('/cost-logs', { query: reportQueryCostLogListQuery, response: paginated(reportQueryCostLogSchema), summary: '查询成本日志' }),
  costStats: op.get('/cost-stats', { query: reportQueryCostRangeQuery, response: reportQueryCostStatsSchema, summary: '查询成本统计' }),
  costTrend: op.get('/cost-trend', { query: reportQueryCostTrendQuery, response: z.array(reportQueryCostTrendPointSchema), summary: '查询成本趋势' }),
}, { tags: ['报表查询容量'] });
