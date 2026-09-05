import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { REPORT_DATASOURCE_TYPES, REPORT_MATERIALIZATION_STRATEGIES } from '../types';
import {
  createReportDatasetSchema,
  reportBatchStatusSchema,
  reportCloneSchema,
  reportComputedFieldSchema,
  reportDatasetDataBodySchema,
  reportDatasetParamSchema,
  reportDatasetPreviewSchema,
  reportDatasourceTypeSchema,
  reportFieldSchema,
  reportLookupQuerySchema,
  reportRowRuleSchema,
  updateReportDatasetSchema,
} from '../validation';
import { reportDataResultSchema, reportLookupOptionSchema, reportSortOrderSchema, reportStatusSchema } from './_common';
import { reportEmptyConfigSchema } from './datasources';

// ─── 可视化建模（选表拖字段生成 SQL，内置库专用） ────────────────────────────────

/** 可视化建模：指标（聚合列） */
export const reportVisualMetricSchema = z.object({
  field: z.string(),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count']),
  alias: z.string().optional(),
}).meta({ id: 'ReportVisualMetric' });

export type ReportVisualMetric = z.infer<typeof reportVisualMetricSchema>;

/** 可视化建模：筛选条件 */
export const reportVisualFilterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like']),
  value: z.string(),
}).meta({ id: 'ReportVisualFilter' });

export type ReportVisualFilter = z.infer<typeof reportVisualFilterSchema>;

export const reportVisualJoinSchema = z.object({
  type: z.enum(['inner', 'left']),
  table: z.string(),
  alias: z.string().optional(),
  sourceAlias: z.string().optional(),
  sourceField: z.string(),
  targetField: z.string(),
}).meta({ id: 'ReportVisualJoin' });

export type ReportVisualJoin = z.infer<typeof reportVisualJoinSchema>;

export const reportVisualModelSchema = z.object({
  table: z.string(),
  alias: z.string().optional(),
  joins: z.array(reportVisualJoinSchema).optional(),
  dimensions: z.array(z.string()).meta({ description: '维度列（GROUP BY）' }),
  metrics: z.array(reportVisualMetricSchema).meta({ description: '指标列（聚合）' }),
  filters: z.array(reportVisualFilterSchema).optional(),
  orderBy: z.object({ field: z.string(), order: reportSortOrderSchema }).nullable().optional(),
  limit: z.number().nullable().optional(),
}).meta({ id: 'ReportVisualModel' });

export type ReportVisualModel = z.infer<typeof reportVisualModelSchema>;

// ─── 数据集内容（形态随数据源类型而定） ─────────────────────────────────────────

/** SQL 数据集内容 */
export const reportSqlDatasetContentSchema = z.object({
  sql: z.string(),
  visual: reportVisualModelSchema.nullable().optional().meta({ description: '可视化建模模型（回显编辑用；SQL 为最终执行内容）' }),
}).meta({ id: 'ReportSqlDatasetContent' });

export type ReportSqlDatasetContent = z.infer<typeof reportSqlDatasetContentSchema>;

/** API 数据集内容 */
export const reportApiDatasetContentSchema = z.object({
  itemsPath: z.string().nullable().optional().meta({ description: '响应中数组所在路径，点分隔（如 data.list），留空表示根即数组' }),
  params: z.record(z.string(), z.string()).nullable().optional().meta({ description: '附加查询参数' }),
}).meta({ id: 'ReportApiDatasetContent' });

export type ReportApiDatasetContent = z.infer<typeof reportApiDatasetContentSchema>;

/** 静态数据集内容（内联 JSON / 文件上传解析结果） */
export const reportStaticDatasetContentSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(z.string()).optional().meta({ description: '列顺序（缺省按首行键）' }),
}).meta({ id: 'ReportStaticDatasetContent' });

export type ReportStaticDatasetContent = z.infer<typeof reportStaticDatasetContentSchema>;

export const reportDatasetContentSchema = z.union([
  reportSqlDatasetContentSchema,
  reportApiDatasetContentSchema,
  reportStaticDatasetContentSchema,
  reportEmptyConfigSchema,
]).meta({ id: 'ReportDatasetContent' });

export type ReportDatasetContent = z.infer<typeof reportDatasetContentSchema>;

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 数据集物化快照配置（含服务端注入的只读刷新时间） */
export const reportDatasetMaterializeStateSchema = z.object({
  enabled: z.boolean(),
  cron: z.string().optional().meta({ description: '刷新 Cron（留空 = 仅手动刷新）' }),
  strategy: z.enum(REPORT_MATERIALIZATION_STRATEGIES).optional(),
  keyField: z.string().nullable().optional(),
  deltaWindowMinutes: z.int().nullable().optional(),
  refreshedAt: z.string().nullable().optional().meta({ description: '最近刷新时间（只读，服务端注入）' }),
  refreshedAtMs: z.number().nullable().optional().meta({ description: '最近刷新时间戳（epoch 毫秒）' }),
}).meta({ id: 'ReportDatasetMaterialize' });

export type ReportDatasetMaterialize = z.infer<typeof reportDatasetMaterializeStateSchema>;

export type ReportRowRule = z.infer<typeof reportRowRuleSchema>;

export const reportDatasetSchema = z.object({
  id: z.int(),
  name: z.string(),
  ownerId: z.int().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  folderId: z.int().nullable().optional(),
  folderName: z.string().nullable().optional(),
  datasourceId: z.int(),
  datasourceName: z.string().nullable().optional(),
  type: z.enum(REPORT_DATASOURCE_TYPES).meta({ description: '从数据源继承的类型' }),
  content: reportDatasetContentSchema,
  fields: z.array(reportFieldSchema),
  params: z.array(reportDatasetParamSchema),
  computedFields: z.array(reportComputedFieldSchema),
  cacheTtl: z.int().meta({ description: '结果缓存 TTL（秒），0 = 不缓存' }),
  materialize: reportDatasetMaterializeStateSchema.optional(),
  rowRules: z.array(reportRowRuleSchema).optional(),
  status: reportStatusSchema,
  remark: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDataset' });

export type ReportDataset = z.infer<typeof reportDatasetSchema>;

const refNamedSchema = z.object({ id: z.int(), name: z.string() });
const refDashboardBoundSchema = z.object({ id: z.int(), dashboardId: z.int(), name: z.string() });

/** 数据集下游引用（血缘：删除保护与影响分析） */
export const reportDatasetRefsSchema = z.object({
  dashboards: z.array(z.object({ id: z.int(), name: z.string(), widgets: z.array(z.string()), filterIds: z.array(z.string()) })),
  printTemplates: z.array(refNamedSchema),
  metrics: z.array(z.object({ id: z.int(), code: z.string(), name: z.string() })),
  alerts: z.array(refNamedSchema),
  subscriptions: z.array(refDashboardBoundSchema).optional(),
  shares: z.array(refDashboardBoundSchema).optional(),
  embedTokens: z.array(refDashboardBoundSchema).optional(),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(['datasource', 'dataset', 'metric', 'dashboard', 'widget', 'filter', 'print', 'alert', 'subscription', 'share', 'embed']),
    refId: z.int().nullable().optional(),
    parentId: z.string().nullable().optional(),
    label: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().nullable().optional(),
  })).optional(),
}).meta({ id: 'ReportDatasetRefs' });

export type ReportDatasetRefs = z.infer<typeof reportDatasetRefsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportDatasetListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  datasourceId: z.coerce.number().int().positive().optional(),
  type: reportDatasourceTypeSchema.optional(),
  status: reportStatusSchema.optional(),
});

export const reportDatasetContract = defineContract('/api/report/datasets', {
  list: op.get('/', { query: reportDatasetListQuery, response: paginated(reportDatasetSchema), summary: '数据集列表' }),
  lookup: op.get('/lookup', { query: reportLookupQuerySchema, response: z.array(reportLookupOptionSchema), summary: '数据集轻量下拉' }),
  preview: op.post('/preview', { body: reportDatasetPreviewSchema, response: reportDataResultSchema, summary: '试跑预览（不落库）' }),
  parseFile: op.post('/parse-file', {
    body: multipart(z.object({ file: fileField('Excel（.xlsx）或 CSV 文件，最大 20MB') })),
    response: reportDataResultSchema,
    summary: '解析上传的文件数据集（Excel / CSV → 列与数据行）',
  }),
  data: op.post('/{id}/data', { params: idParam, body: reportDatasetDataBodySchema, response: reportDataResultSchema, summary: '取数据集数据（带参数）' }),
  batchStatus: op.put('/batch-status', { body: reportBatchStatusSchema, summary: '批量启停数据集' }),
  materialize: op.post('/{id}/materialize', { params: idParam, response: asyncTaskSchema, summary: '手动刷新物化快照' }),
  refs: op.get('/{id}/refs', { params: idParam, response: reportDatasetRefsSchema, summary: '数据集下游引用（血缘）' }),
  detail: op.get('/{id}', { params: idParam, response: reportDatasetSchema, summary: '数据集详情' }),
  create: op.post('/', { body: createReportDatasetSchema, response: reportDatasetSchema, summary: '创建数据集' }),
  update: op.put('/{id}', { params: idParam, body: updateReportDatasetSchema, response: reportDatasetSchema, summary: '更新数据集' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除数据集' }),
  clone: op.post('/{id}/clone', { params: idParam, body: reportCloneSchema, response: reportDatasetSchema, summary: '复制数据集' }),
}, { tags: ['报表数据集'] });
