import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { REPORT_DQ_TRIGGER_TYPES } from '../constants';
import { REPORT_DQ_ANOMALY_STATUSES, REPORT_DQ_RULE_TYPES, REPORT_DQ_RUN_STATUSES, REPORT_DQ_SEVERITIES } from '../types';
import {
  createReportDqRuleSchema,
  reportDqAnomalyStatusSchema,
  reportDqRuleConfigSchema,
  reportDqRuleTypeSchema,
  reportDqRunStatusSchema,
  runReportDqRuleSchema,
  updateReportDqAnomalyStatusSchema,
  updateReportDqRuleSchema,
} from '../validation';
import { strictQueryBool } from './_common';

// ─── 数据质量 ───────────────────────────────────────────────────────────────

export type ReportDqRuleConfig = z.infer<typeof reportDqRuleConfigSchema>;

export const reportDqRuleSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  datasetId: z.int(),
  datasetName: z.string().nullable().optional(),
  name: z.string(),
  type: z.enum(REPORT_DQ_RULE_TYPES),
  field: z.string().nullable().optional(),
  severity: z.enum(REPORT_DQ_SEVERITIES),
  config: reportDqRuleConfigSchema,
  cron: z.string().nullable().optional(),
  timezone: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.string().nullable().optional(),
  lastStatus: z.enum(REPORT_DQ_RUN_STATUSES).nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDqRule' });

export type ReportDqRule = z.infer<typeof reportDqRuleSchema>;

export const reportDqRunSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  ruleId: z.int(),
  ruleName: z.string().nullable().optional(),
  datasetId: z.int(),
  datasetName: z.string().nullable().optional(),
  status: z.enum(REPORT_DQ_RUN_STATUSES),
  triggerType: z.enum(REPORT_DQ_TRIGGER_TYPES),
  checkedRows: z.int(),
  failedRows: z.int(),
  passRate: z.number().nullable().optional(),
  sampleRows: z.array(z.record(z.string(), z.unknown())),
  sampleRowCount: z.int(),
  sampleBytes: z.int(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  durationMs: z.int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  schemaSignature: z.string().nullable().optional(),
  requestedBy: z.int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDqRun' });

export type ReportDqRun = z.infer<typeof reportDqRunSchema>;

export const reportDqScoreSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  datasetId: z.int(),
  score: z.number(),
  passedRules: z.int(),
  failedRules: z.int(),
  totalRules: z.int(),
  measuredAt: z.string(),
  dimensions: z.record(z.string(), z.number()),
  createdAt: z.string(),
}).meta({ id: 'ReportDqScore' });

export type ReportDqScore = z.infer<typeof reportDqScoreSchema>;

export const reportDqAnomalySchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  datasetId: z.int(),
  datasetName: z.string().nullable().optional(),
  ruleId: z.int().nullable().optional(),
  ruleName: z.string().nullable().optional(),
  runId: z.int().nullable().optional(),
  severity: z.enum(REPORT_DQ_SEVERITIES),
  title: z.string(),
  detail: z.string().nullable().optional(),
  sample: z.record(z.string(), z.unknown()),
  sampleRowCount: z.int().optional(),
  sampleBytes: z.int().optional(),
  status: z.enum(REPORT_DQ_ANOMALY_STATUSES),
  acknowledgedAt: z.string().nullable().optional(),
  acknowledgedBy: z.int().nullable().optional(),
  acknowledgementNote: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: z.int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDqAnomaly' });

export type ReportDqAnomaly = z.infer<typeof reportDqAnomalySchema>;

export const reportDqRuleListQuery = paginationQuery.extend({
  datasetId: z.coerce.number().int().positive().optional(),
  type: reportDqRuleTypeSchema.optional(),
  enabled: strictQueryBool,
});

export const reportDqRunListQuery = paginationQuery.extend({
  datasetId: z.coerce.number().int().positive().optional(),
  ruleId: z.coerce.number().int().positive().optional(),
  status: reportDqRunStatusSchema.optional(),
});

export const reportDqAnomalyListQuery = paginationQuery.extend({
  datasetId: z.coerce.number().int().positive().optional(),
  status: reportDqAnomalyStatusSchema.optional(),
});

export const reportDqContract = defineContract('/api/report/dq', {
  rules: op.get('/rules', { query: reportDqRuleListQuery, response: paginated(reportDqRuleSchema), summary: '质量规则列表' }),
  ruleDetail: op.get('/rules/{id}', { params: idParam, response: reportDqRuleSchema, summary: '质量规则详情' }),
  createRule: op.post('/rules', { body: createReportDqRuleSchema, response: reportDqRuleSchema, summary: '创建质量规则' }),
  updateRule: op.put('/rules/{id}', { params: idParam, body: updateReportDqRuleSchema, response: reportDqRuleSchema, summary: '更新质量规则' }),
  removeRule: op.delete('/rules/{id}', { params: idParam, summary: '删除质量规则' }),
  toggleRule: op.post('/rules/{id}/toggle', { params: idParam, response: reportDqRuleSchema, summary: '启停质量规则' }),
  runRule: op.post('/rules/{id}/run', { params: idParam, body: runReportDqRuleSchema, response: asyncTaskSchema, summary: '异步执行质量规则' }),
  runs: op.get('/runs', { query: reportDqRunListQuery, response: paginated(reportDqRunSchema), summary: '质量运行历史' }),
  scores: op.get('/datasets/{id}/scores', { params: idParam, query: paginationQuery, response: paginated(reportDqScoreSchema), summary: '数据集质量评分历史' }),
  currentScore: op.get('/datasets/{id}/score', { params: idParam, response: reportDqScoreSchema.nullable(), summary: '数据集当前质量评分' }),
  anomalies: op.get('/anomalies', { query: reportDqAnomalyListQuery, response: paginated(reportDqAnomalySchema), summary: '质量异常列表' }),
  updateAnomalyStatus: op.post('/anomalies/{id}/status', { params: idParam, body: updateReportDqAnomalyStatusSchema, response: reportDqAnomalySchema, summary: '确认或解决质量异常' }),
}, { tags: ['报表数据质量'] });
