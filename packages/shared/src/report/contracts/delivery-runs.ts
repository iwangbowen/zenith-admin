import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { acknowledgeReportDeliveryRunSchema } from '../validation';
import {
  reportDeliveryStatusSchema,
  reportDeliveryTargetTypeSchema,
  reportDeliveryTriggerTypeSchema,
  reportNotifyChannelEnum,
} from './_common';

// ─── 投递执行历史 ───────────────────────────────────────────────────────────

export const reportDeliveryAttemptSchema = z.object({
  id: z.int(),
  runId: z.int(),
  channel: reportNotifyChannelEnum,
  attempt: z.int(),
  status: reportDeliveryStatusSchema,
  durationMs: z.int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  payloadSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDeliveryAttempt' });

export type ReportDeliveryAttempt = z.infer<typeof reportDeliveryAttemptSchema>;

export const reportDeliveryRunSchema = z.object({
  id: z.int(),
  targetType: reportDeliveryTargetTypeSchema,
  subscriptionId: z.int().nullable().optional(),
  alertRuleId: z.int().nullable().optional(),
  slaRuleId: z.int().nullable().optional(),
  dashboardId: z.int().nullable().optional(),
  datasetId: z.int().nullable().optional(),
  targetName: z.string().nullable().optional(),
  triggerType: reportDeliveryTriggerTypeSchema,
  status: reportDeliveryStatusSchema,
  idempotencyKey: z.string(),
  attempt: z.int(),
  maxAttempts: z.int(),
  durationMs: z.int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  payloadSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  lastValue: z.number().nullable().optional(),
  triggered: z.boolean().nullable().optional(),
  acknowledgedAt: z.string().nullable().optional(),
  acknowledgedBy: z.int().nullable().optional(),
  acknowledgedByName: z.string().nullable().optional(),
  acknowledgeNote: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  attempts: z.array(reportDeliveryAttemptSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDeliveryRun' });

export type ReportDeliveryRun = z.infer<typeof reportDeliveryRunSchema>;

export const reportDeliveryRunListQuery = paginationQuery.extend({
  targetType: z.enum(['subscription', 'alert']).optional(),
  subscriptionId: z.coerce.number().int().positive().optional(),
  alertRuleId: z.coerce.number().int().positive().optional(),
  status: reportDeliveryStatusSchema.optional(),
  triggerType: z.enum(['trigger', 'recover', 'manual', 'scheduled']).optional(),
  startAt: dateRangeBound('起始时间'),
  endAt: dateRangeBound('结束时间'),
  includeAttempts: queryBool('附带每次尝试明细'),
});

export const reportDeliveryRunContract = defineContract('/api/report/delivery-runs', {
  list: op.get('/', { query: reportDeliveryRunListQuery, response: paginated(reportDeliveryRunSchema), summary: '投递执行历史列表' }),
  acknowledge: op.post('/{id}/acknowledge', { params: idParam, body: acknowledgeReportDeliveryRunSchema, response: reportDeliveryRunSchema, summary: '确认告警投递记录' }),
}, { tags: ['报表投递'] });
