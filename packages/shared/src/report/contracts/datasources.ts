import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { REPORT_DATASOURCE_TYPES } from '../types';
import {
  createReportDatasourceSchema,
  reportBatchStatusSchema,
  reportCloneSchema,
  reportDatasourceTestSchema,
  reportDatasourceTypeSchema,
  reportLookupQuerySchema,
  updateReportDatasourceSchema,
} from '../validation';
import { reportLookupOptionSchema, reportStatusSchema } from './_common';

// ─── 连接配置（形态随 type 而定） ─────────────────────────────────────────────

/** API 数据源连接配置 */
export const reportApiDatasourceConfigSchema = z.object({
  url: z.string(),
  method: z.enum(['GET', 'POST']),
  headers: z.record(z.string(), z.string()).nullable().optional(),
}).meta({ id: 'ReportApiDatasourceConfig' });

export type ReportApiDatasourceConfig = z.infer<typeof reportApiDatasourceConfigSchema>;

/** SQL 数据源连接配置（内置只读主库） */
export const reportSqlDatasourceConfigSchema = z.object({
  connection: z.literal('internal'),
}).meta({ id: 'ReportSqlDatasourceConfig' });

export type ReportSqlDatasourceConfig = z.infer<typeof reportSqlDatasourceConfigSchema>;

/** 外部数据库连接配置（mysql / postgresql / sqlserver）；password 仅写入，读取时脱敏 */
export const reportExternalDbConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string().nullable().optional(),
  ssl: z.boolean().optional().meta({ description: '是否启用 SSL' }),
  hasPassword: z.boolean().optional().meta({ description: '读取时返回的脱敏标记（服务端注入，前端只读）' }),
}).meta({ id: 'ReportExternalDbConfig' });

export type ReportExternalDbConfig = z.infer<typeof reportExternalDbConfigSchema>;

/** 空配置（static 等无需连接参数的类型） */
export const reportEmptyConfigSchema = z.record(z.string(), z.never()).meta({ type: 'object', description: '空对象' });

export const reportDatasourceConfigSchema = z.union([
  reportApiDatasourceConfigSchema,
  reportSqlDatasourceConfigSchema,
  reportExternalDbConfigSchema,
  reportEmptyConfigSchema,
]).meta({ id: 'ReportDatasourceConfig', description: 'api → { url, method, headers }；sql → { connection: internal }；外部库 → 连接参数；static → {}' });

export type ReportDatasourceConfig = z.infer<typeof reportDatasourceConfigSchema>;

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportDatasourceSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable().optional(),
  name: z.string(),
  ownerId: z.int().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  folderId: z.int().nullable().optional(),
  folderName: z.string().nullable().optional(),
  type: z.enum(REPORT_DATASOURCE_TYPES),
  config: reportDatasourceConfigSchema,
  status: reportStatusSchema,
  lastTestAt: z.string().nullable().optional(),
  lastTestStatus: z.enum(['success', 'failed', 'unknown']).nullable().optional(),
  lastTestLatencyMs: z.int().nullable().optional(),
  lastTestError: z.string().nullable().optional(),
  consecutiveFailures: z.int().optional(),
  remark: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDatasource' });

export type ReportDatasource = z.infer<typeof reportDatasourceSchema>;

/** 数据源连接测试结果 */
export const reportDatasourceTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().optional(),
}).meta({ id: 'ReportDatasourceTestResult' });

export type ReportDatasourceTestResult = z.infer<typeof reportDatasourceTestResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportDatasourceListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  type: reportDatasourceTypeSchema.optional(),
  status: reportStatusSchema.optional(),
});

export const reportDatasourceContract = defineContract('/api/report/datasources', {
  list: op.get('/', { query: reportDatasourceListQuery, response: paginated(reportDatasourceSchema), summary: '数据源列表' }),
  lookup: op.get('/lookup', { query: reportLookupQuerySchema, response: z.array(reportLookupOptionSchema), summary: '数据源轻量下拉' }),
  batchStatus: op.put('/batch-status', { body: reportBatchStatusSchema, summary: '批量启停数据源' }),
  detail: op.get('/{id}', { params: idParam, response: reportDatasourceSchema, summary: '数据源详情' }),
  create: op.post('/', { body: createReportDatasourceSchema, response: reportDatasourceSchema, summary: '创建数据源' }),
  update: op.put('/{id}', { params: idParam, body: updateReportDatasourceSchema, response: reportDatasourceSchema, summary: '更新数据源' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除数据源' }),
  test: op.post('/test', { body: reportDatasourceTestSchema, response: reportDatasourceTestResultSchema, summary: '测试数据源连接（外部库）' }),
  testOne: op.post('/{id}/test', { params: idParam, response: reportDatasourceTestResultSchema, summary: '测试并持久化数据源健康状态' }),
  clone: op.post('/{id}/clone', { params: idParam, body: reportCloneSchema, response: reportDatasourceSchema, summary: '复制数据源' }),
  healthCheck: op.post('/health-check', { body: batchIdsBody, response: asyncTaskSchema, summary: '批量健康检查' }),
}, { tags: ['报表数据源'] });
