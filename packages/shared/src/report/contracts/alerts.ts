import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { createReportAlertSchema, reportBatchEnabledSchema, updateReportAlertSchema } from '../validation';
import {
  reportAlertAggregateSchema,
  reportAlertOpSchema,
  reportDeliveryStatusSchema,
  reportMisfirePolicyEnum,
  reportNotifyChannelEnum,
} from './_common';

// ─── 数据预警 ───────────────────────────────────────────────────────────────

export const reportAlertRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  datasetId: z.int().nullable().meta({ description: '监控的数据集' }),
  datasetName: z.string().nullable().optional(),
  metricId: z.int().nullable().optional().meta({ description: '指标预警来源；设置后 datasetId 必须为空' }),
  metricName: z.string().nullable().optional(),
  field: z.string().nullable().optional().meta({ description: '监控字段（count 可空）' }),
  groupByField: z.string().nullable().optional().meta({ description: '分组维度（可空 = 全局聚合）' }),
  aggregate: reportAlertAggregateSchema,
  op: reportAlertOpSchema,
  threshold: z.number(),
  cron: z.string().nullable().optional().meta({ description: '评估 Cron（留空 = 仅手动）' }),
  timezone: z.string(),
  misfirePolicy: reportMisfirePolicyEnum,
  channels: z.array(reportNotifyChannelEnum),
  recipients: z.string().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  silenceMins: z.int().meta({ description: '静默期（分钟）；0 = 每次触发都通知' }),
  notifyOnRecover: z.boolean(),
  enabled: z.boolean(),
  lastCheckedAt: z.string().nullable().optional(),
  lastTriggered: z.boolean().nullable().optional(),
  lastValue: z.number().nullable().optional(),
  lastNotifiedAt: z.string().nullable().optional(),
  nextRunAt: z.string().nullable().optional(),
  lastDeliveryAt: z.string().nullable().optional(),
  lastDeliveryStatus: reportDeliveryStatusSchema.nullable().optional(),
  lastDeliveryError: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportAlertRule' });

export type ReportAlertRule = z.infer<typeof reportAlertRuleSchema>;

/** 预警评估命中组明细（分组维度评估时返回） */
export const reportAlertEvalHitSchema = z.object({
  group: z.string(),
  value: z.number(),
}).meta({ id: 'ReportAlertEvalHit' });

export type ReportAlertEvalHit = z.infer<typeof reportAlertEvalHitSchema>;

/** 预警评估结果（任务执行产物） */
export const reportAlertEvalResultSchema = z.object({
  value: z.number(),
  triggered: z.boolean(),
  status: reportDeliveryStatusSchema.nullable().optional(),
  deliveryRunId: z.int().nullable().optional(),
  hits: z.array(reportAlertEvalHitSchema).optional().meta({ description: '分组评估时的命中组明细（最多 10 条）' }),
}).meta({ id: 'ReportAlertEvalResult' });

export type ReportAlertEvalResult = z.infer<typeof reportAlertEvalResultSchema>;

export const reportAlertListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  datasetId: z.coerce.number().int().positive().optional(),
  metricId: z.coerce.number().int().positive().optional(),
  enabled: queryBool(),
});

export const reportAlertContract = defineContract('/api/report/alerts', {
  list: op.get('/', { query: reportAlertListQuery, response: paginated(reportAlertRuleSchema), summary: '预警规则列表' }),
  batchStatus: op.put('/batch-status', { body: reportBatchEnabledSchema, summary: '批量启停预警' }),
  detail: op.get('/{id}', { params: idParam, response: reportAlertRuleSchema, summary: '预警规则详情' }),
  create: op.post('/', { body: createReportAlertSchema, response: reportAlertRuleSchema, summary: '创建预警规则' }),
  update: op.put('/{id}', { params: idParam, body: updateReportAlertSchema, response: reportAlertRuleSchema, summary: '更新预警规则' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除预警规则' }),
  evaluate: op.post('/{id}/evaluate', { params: idParam, response: asyncTaskSchema, summary: '手动评估预警' }),
}, { tags: ['报表预警'] });
