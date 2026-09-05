import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_CHATBI_MESSAGE_ROLES, REPORT_CHATBI_SESSION_STATUSES, REPORT_DATASOURCE_TYPES, REPORT_RESOURCE_TYPES, REPORT_WIDGET_TYPES } from '../types';
import {
  createReportChatbiMessageSchema,
  createReportChatbiSessionSchema,
  reportChatbiSessionStatusSchema,
  saveReportChatbiMessageAssetSchema,
  updateReportChatbiSessionSchema,
} from '../validation';
import { strictQueryBool } from './_common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportChatbiChartSuggestionSchema = z.object({
  type: z.enum(REPORT_WIDGET_TYPES),
  title: z.string(),
  categoryField: z.string().optional(),
  valueFields: z.array(z.string()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'ReportChatbiChartSuggestion' });

export type ReportChatbiChartSuggestion = z.infer<typeof reportChatbiChartSuggestionSchema>;

/** 会话创建时冻结的数据上下文（数据源 / 表 / 列） */
export const reportChatbiContextSnapshotSchema = z.object({
  datasourceId: z.int(),
  datasourceName: z.string(),
  datasourceType: z.enum(REPORT_DATASOURCE_TYPES),
  datasetId: z.int().nullable().optional(),
  tables: z.array(z.object({
    name: z.string(),
    columns: z.array(z.object({ name: z.string(), type: z.string() })),
  })),
  frozenAt: z.string(),
}).meta({ id: 'ReportChatbiContextSnapshot' });

export type ReportChatbiContextSnapshot = z.infer<typeof reportChatbiContextSnapshotSchema>;

export const reportChatbiSessionSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  userId: z.int(),
  title: z.string(),
  datasourceId: z.int().nullable().optional(),
  datasetId: z.int().nullable().optional(),
  allowedTables: z.array(z.string()),
  contextSnapshot: reportChatbiContextSnapshotSchema,
  status: z.enum(REPORT_CHATBI_SESSION_STATUSES),
  totalTokens: z.int(),
  totalCostUnits: z.number(),
  lastMessageAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportChatbiSession' });

export type ReportChatbiSession = z.infer<typeof reportChatbiSessionSchema>;

export const reportChatbiMessageSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  sessionId: z.int(),
  userId: z.int().nullable().optional(),
  role: z.enum(REPORT_CHATBI_MESSAGE_ROLES),
  content: z.string(),
  generatedSql: z.string().nullable().optional(),
  chartSuggestion: reportChatbiChartSuggestionSchema.nullable().optional(),
  resultSample: z.array(z.record(z.string(), z.unknown())),
  resultRowCount: z.int(),
  resultByteSize: z.int(),
  savedResourceType: z.enum(REPORT_RESOURCE_TYPES).nullable().optional(),
  savedResourceId: z.int().nullable().optional(),
  savedDatasetId: z.int().nullable().optional(),
  savedDashboardId: z.int().nullable().optional(),
  promptTokens: z.int(),
  completionTokens: z.int(),
  costUnits: z.number(),
  latencyMs: z.int().nullable().optional(),
  modelId: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'ReportChatbiMessage' });

export type ReportChatbiMessage = z.infer<typeof reportChatbiMessageSchema>;

export const reportChatbiSessionDetailSchema = z.object({
  session: reportChatbiSessionSchema,
  messages: z.array(reportChatbiMessageSchema),
}).meta({ id: 'ReportChatbiSessionDetail' });

export type ReportChatbiSessionDetail = z.infer<typeof reportChatbiSessionDetailSchema>;

export const reportChatbiQuotaSchema = z.object({
  aiPromptTokensToday: z.int(),
  aiCompletionTokensToday: z.int(),
  aiRequestsToday: z.int(),
  queryCountToday: z.int(),
  queryRowsToday: z.int(),
  queryBytesToday: z.int(),
  queryCostUnitsToday: z.number(),
}).meta({ id: 'ReportChatbiQuota' });

export type ReportChatbiQuota = z.infer<typeof reportChatbiQuotaSchema>;

export const reportChatbiSavedResourceSchema = z.object({
  resourceType: z.enum(['dataset', 'dashboard']),
  resourceId: z.int(),
  name: z.string(),
  datasetId: z.int().nullable().optional(),
}).meta({ id: 'ReportChatbiSavedResource' });

export type ReportChatbiSavedResource = z.infer<typeof reportChatbiSavedResourceSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportChatbiSessionListQuery = paginationQuery.extend({
  keyword: z.string().max(128).optional(),
  status: reportChatbiSessionStatusSchema.optional(),
  userId: z.coerce.number().int().positive().optional(),
});

export const reportChatbiAuditQuery = paginationQuery.extend({
  userId: z.coerce.number().int().positive().optional(),
  failedOnly: strictQueryBool,
});

export const reportChatbiContract = defineContract('/api/report/chatbi', {
  sessions: op.get('/sessions', { query: reportChatbiSessionListQuery, response: paginated(reportChatbiSessionSchema), summary: 'ChatBI 会话列表' }),
  createSession: op.post('/sessions', { body: createReportChatbiSessionSchema, response: reportChatbiSessionSchema, summary: '创建 ChatBI 会话' }),
  sessionDetail: op.get('/sessions/{id}', { params: idParam, response: reportChatbiSessionDetailSchema, summary: 'ChatBI 会话详情与消息历史' }),
  updateSession: op.put('/sessions/{id}', { params: idParam, body: updateReportChatbiSessionSchema, response: reportChatbiSessionSchema, summary: '更新 ChatBI 会话' }),
  archiveSession: op.post('/sessions/{id}/archive', { params: idParam, response: reportChatbiSessionSchema, summary: '归档 ChatBI 会话' }),
  removeSession: op.delete('/sessions/{id}', { params: idParam, summary: '删除 ChatBI 会话' }),
  ask: op.post('/sessions/{id}/ask', { params: idParam, body: createReportChatbiMessageSchema, response: reportChatbiMessageSchema, summary: 'ChatBI 多轮提问' }),
  saveMessage: op.post('/messages/{id}/save', { params: idParam, body: saveReportChatbiMessageAssetSchema, response: reportChatbiSavedResourceSchema, summary: '保存 ChatBI 回答为数据集或仪表盘' }),
  myQuota: op.get('/quotas/me', { response: reportChatbiQuotaSchema, summary: '我的 ChatBI 当日用量' }),
  audit: op.get('/audit', { query: reportChatbiAuditQuery, response: paginated(reportChatbiMessageSchema), summary: 'ChatBI 审计与成本明细' }),
}, { tags: ['报表 ChatBI'] });
