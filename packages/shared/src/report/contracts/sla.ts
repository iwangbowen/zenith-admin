import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { REPORT_DQ_SEVERITIES, REPORT_SLA_TYPES, REPORT_SLA_VIOLATION_STATUSES } from '../types';
import { createReportSlaRuleSchema, reportSlaTypeSchema, reportSlaViolationStatusSchema, updateReportSlaRuleSchema, updateReportSlaViolationSchema } from '../validation';
import { reportNotifyChannelEnum, strictQueryBool } from './_common';

// ─── SLA ────────────────────────────────────────────────────────────────────

export const reportSlaRuleSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  datasetId: z.int(),
  name: z.string(),
  type: z.enum(REPORT_SLA_TYPES),
  targetValue: z.number(),
  warningValue: z.number().nullable().optional(),
  windowMinutes: z.int(),
  cron: z.string().nullable().optional(),
  timezone: z.string(),
  severity: z.enum(REPORT_DQ_SEVERITIES),
  channels: z.array(reportNotifyChannelEnum),
  recipients: z.string().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  silenceMins: z.int(),
  enabled: z.boolean(),
  lastEvaluatedAt: z.string().nullable().optional(),
  lastNotifiedAt: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportSlaRule' });

export type ReportSlaRule = z.infer<typeof reportSlaRuleSchema>;

export const reportSlaViolationSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  ruleId: z.int(),
  datasetId: z.int(),
  status: z.enum(REPORT_SLA_VIOLATION_STATUSES),
  observedValue: z.number(),
  targetValue: z.number(),
  windowStartedAt: z.string(),
  windowEndedAt: z.string(),
  detail: z.string().nullable().optional(),
  acknowledgedAt: z.string().nullable().optional(),
  acknowledgedBy: z.int().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: z.int().nullable().optional(),
  resolutionNote: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportSlaViolation' });

export type ReportSlaViolation = z.infer<typeof reportSlaViolationSchema>;

export const reportSlaRuleListQuery = paginationQuery.extend({
  datasetId: z.coerce.number().int().positive().optional(),
  type: reportSlaTypeSchema.optional(),
  enabled: strictQueryBool,
});

export const reportSlaViolationListQuery = paginationQuery.extend({
  datasetId: z.coerce.number().int().positive().optional(),
  ruleId: z.coerce.number().int().positive().optional(),
  status: reportSlaViolationStatusSchema.optional(),
});

export const reportSlaContract = defineContract('/api/report/sla', {
  rules: op.get('/rules', { query: reportSlaRuleListQuery, response: paginated(reportSlaRuleSchema), summary: 'SLA 规则列表' }),
  ruleDetail: op.get('/rules/{id}', { params: idParam, response: reportSlaRuleSchema, summary: 'SLA 规则详情' }),
  createRule: op.post('/rules', { body: createReportSlaRuleSchema, response: reportSlaRuleSchema, summary: '创建 SLA 规则' }),
  updateRule: op.put('/rules/{id}', { params: idParam, body: updateReportSlaRuleSchema, response: reportSlaRuleSchema, summary: '更新 SLA 规则' }),
  removeRule: op.delete('/rules/{id}', { params: idParam, summary: '删除 SLA 规则' }),
  evaluate: op.post('/rules/{id}/evaluate', { params: idParam, response: asyncTaskSchema, summary: '异步评估 SLA' }),
  violations: op.get('/violations', { query: reportSlaViolationListQuery, response: paginated(reportSlaViolationSchema), summary: 'SLA 违规列表' }),
  updateViolationStatus: op.post('/violations/{id}/status', { params: idParam, body: updateReportSlaViolationSchema, response: reportSlaViolationSchema, summary: '确认或解决 SLA 违规' }),
}, { tags: ['报表 SLA'] });
