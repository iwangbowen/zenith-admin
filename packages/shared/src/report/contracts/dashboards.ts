import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_DASHBOARD_LIFECYCLE_STATUSES, REPORT_SORT_ORDERS } from '../constants';
import { REPORT_WIDGET_TYPES } from '../types';
import {
  createReportDashboardSchema,
  reportBatchStatusSchema,
  reportCanvasItemSchema,
  reportCloneSchema,
  reportDashboardBatchSchema,
  reportDashboardConfigSchema,
  reportDashboardDataBodySchema,
  reportDashboardLifecycleActionSchema,
  reportDashboardLifecycleStatusSchema,
  reportDashboardViewModeSchema,
  reportFieldSchema,
  reportFilterSchema,
  reportGridItemSchema,
  reportLookupQuerySchema,
  reportScreenConfigSchema,
  updateReportDashboardSchema,
} from '../validation';
import { reportDashboardDataSchema, reportLookupOptionSchema, reportStatusSchema } from './_common';

// ─── 布局 / 筛选器 / 全局配置（与请求校验同源） ─────────────────────────────────

export type ReportGridItem = z.infer<typeof reportGridItemSchema>;
export type ReportCanvasItem = z.infer<typeof reportCanvasItemSchema>;
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type ReportFilterOptionSource = NonNullable<ReportFilter['optionSource']>;
export type ReportScreenConfig = z.infer<typeof reportScreenConfigSchema>;
export type ReportDashboardConfig = z.infer<typeof reportDashboardConfigSchema>;
export type ReportCarouselConfig = NonNullable<ReportDashboardConfig['carousel']>;

// ─── 组件（部件）配置 ─────────────────────────────────────────────────────────

/** 表格条件格式规则 */
export const reportConditionalFormatSchema = z.object({
  field: z.string(),
  op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'neq', 'between']),
  value: z.number(),
  value2: z.number().optional(),
  color: z.string().optional(),
  background: z.string().optional(),
}).meta({ id: 'ReportConditionalFormat' });

export type ReportConditionalFormat = z.infer<typeof reportConditionalFormatSchema>;

const widgetAggregateSchema = z.enum(['sum', 'avg', 'max', 'min', 'count']);

/** 组件字段映射 + 图表选项 */
export const reportWidgetOptionsSchema = z.object({
  categoryField: z.string().optional().meta({ description: '柱 / 线 / 饼：分类（x 轴）字段' }),
  valueFields: z.array(z.string()).optional().meta({ description: '柱 / 线 / 饼：指标（y 轴）字段，可多列' }),
  valueField: z.string().optional().meta({ description: '指标卡：取值列' }),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'first']).optional().meta({ description: '指标卡：聚合方式' }),
  unit: z.string().optional(),
  columns: z.array(reportFieldSchema).optional().meta({ description: '表格：展示列（留空 = 全部字段）' }),
  smooth: z.boolean().optional(),
  stack: z.boolean().optional(),
  percent: z.boolean().optional(),
  horizontal: z.boolean().optional(),
  showLabel: z.boolean().optional(),
  secondaryFields: z.array(z.string()).optional().meta({ description: '组合图：右轴（次坐标）指标字段' }),
  secondaryAsLine: z.boolean().optional(),
  sortField: z.string().optional(),
  sortOrder: z.enum(REPORT_SORT_ORDERS).optional(),
  topN: z.number().optional(),
  compareField: z.string().optional().meta({ description: '指标卡：对比字段（环比 / 同比基准）' }),
  targetValue: z.number().optional(),
  trendField: z.string().optional(),
  decimals: z.number().optional(),
  prefix: z.string().optional(),
  pageSize: z.number().optional().meta({ description: '表格：分页大小（0 = 不分页）' }),
  showSummary: z.boolean().optional(),
  conditionalFormats: z.array(reportConditionalFormatSchema).optional(),
  pivotRows: z.array(z.string()).optional(),
  pivotColumns: z.array(z.string()).optional(),
  pivotValueField: z.string().optional(),
  pivotAggregate: widgetAggregateSchema.optional(),
  text: z.string().optional().meta({ description: '文本组件内容（支持 ${filterId} 占位）' }),
  min: z.number().optional(),
  max: z.number().optional(),
  flipDigits: z.number().optional(),
  scrollSpeed: z.number().optional(),
  showRank: z.boolean().optional(),
  mapGeojsonUrl: z.string().optional(),
  mapName: z.string().optional(),
  areaField: z.string().optional(),
  sourceField: z.string().optional(),
  targetField: z.string().optional(),
  wordField: z.string().optional(),
  yField: z.string().optional(),
  src: z.string().optional().meta({ description: '资源 URL（image 图片地址 / iframe 内嵌地址；支持 ${filterId} 占位）' }),
  fit: z.enum(['contain', 'cover', 'fill']).optional(),
}).meta({ id: 'ReportWidgetOptions' });

export type ReportWidgetOptions = z.infer<typeof reportWidgetOptionsSchema>;

/** 筛选器 → 数据集参数 绑定 */
export const reportWidgetParamBindingSchema = z.object({
  filterId: z.string(),
  param: z.string(),
}).meta({ id: 'ReportWidgetParamBinding' });

export type ReportWidgetParamBinding = z.infer<typeof reportWidgetParamBindingSchema>;

/** 点击联动配置 */
export const reportWidgetInteractionSchema = z.object({
  enabled: z.boolean().optional(),
  setFilterId: z.string().optional(),
}).meta({ id: 'ReportWidgetInteraction' });

export type ReportWidgetInteraction = z.infer<typeof reportWidgetInteractionSchema>;

/** 钻取配置 */
export const reportWidgetDrilldownSchema = z.object({
  enabled: z.boolean().optional(),
  type: z.enum(['fields', 'dashboard', 'url']).optional(),
  fields: z.array(z.string()).optional(),
  targetDashboardId: z.int().nullable().optional(),
  url: z.string().optional(),
  paramName: z.string().optional(),
}).meta({ id: 'ReportWidgetDrilldown' });

export type ReportWidgetDrilldown = z.infer<typeof reportWidgetDrilldownSchema>;

/** 组件样式 */
export const reportWidgetStyleSchema = z.object({
  background: z.string().optional(),
  showHeader: z.boolean().optional(),
  borderless: z.boolean().optional(),
}).meta({ id: 'ReportWidgetStyle' });

export type ReportWidgetStyle = z.infer<typeof reportWidgetStyleSchema>;

/** 仪表盘组件配置（响应形态：options 为已归一化的类型化选项） */
export const reportDashboardWidgetSchema = z.object({
  i: z.string().meta({ description: '组件 id（与 layout item 的 i 对应）' }),
  type: z.enum(REPORT_WIDGET_TYPES),
  title: z.string(),
  datasetId: z.int().nullable().optional(),
  metricId: z.int().nullable().optional().meta({ description: '语义指标来源；仅 KPI / gauge / flipper / liquid 组件使用，优先于 datasetId' }),
  options: reportWidgetOptionsSchema,
  paramBindings: z.array(reportWidgetParamBindingSchema).optional(),
  interaction: reportWidgetInteractionSchema.optional(),
  drilldown: reportWidgetDrilldownSchema.optional(),
  style: reportWidgetStyleSchema.optional(),
  page: z.number().optional().meta({ description: '多屏轮播：所属页码（1 基，缺省 = 第 1 页）' }),
}).meta({ id: 'ReportWidget' });

export type ReportWidget = z.infer<typeof reportDashboardWidgetSchema>;

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 仪表盘快照内容（发布态 / 版本历史统一复用） */
export const reportDashboardSnapshotSchema = z.object({
  name: z.string(),
  layout: z.array(reportGridItemSchema),
  canvasLayout: z.array(reportCanvasItemSchema).optional(),
  widgets: z.array(reportDashboardWidgetSchema),
  filters: z.array(reportFilterSchema),
  config: reportDashboardConfigSchema,
  categoryId: z.int().nullable().optional(),
  remark: z.string().nullable().optional(),
}).meta({ id: 'ReportDashboardSnapshot' });

export type ReportDashboardSnapshot = z.infer<typeof reportDashboardSnapshotSchema>;

export const reportDashboardSchema = z.object({
  id: z.int(),
  name: z.string(),
  ownerId: z.int().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  folderId: z.int().nullable().optional(),
  folderName: z.string().nullable().optional(),
  layout: z.array(reportGridItemSchema),
  canvasLayout: z.array(reportCanvasItemSchema).meta({ description: '自由画布定位（canvas 模式）' }),
  widgets: z.array(reportDashboardWidgetSchema),
  filters: z.array(reportFilterSchema),
  config: reportDashboardConfigSchema,
  categoryId: z.int().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  favorited: z.boolean().optional().meta({ description: '当前用户是否已收藏（列表 / 详情按需附加）' }),
  status: reportStatusSchema,
  lifecycleStatus: z.enum(REPORT_DASHBOARD_LIFECYCLE_STATUSES),
  revision: z.int(),
  publishedSnapshot: reportDashboardSnapshotSchema.nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  publishedBy: z.int().nullable().optional(),
  publishedByName: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDashboard' });

export type ReportDashboard = z.infer<typeof reportDashboardSchema>;

/** 草稿保存 / 发布 / 下线 / 恢复版本时的乐观锁冲突载荷（HTTP 409 的 data） */
export const reportDashboardRevisionConflictSchema = z.object({
  currentRevision: z.int(),
  dashboard: reportDashboardSchema,
}).meta({ id: 'ReportDashboardRevisionConflict' });

export type ReportDashboardRevisionConflict = z.infer<typeof reportDashboardRevisionConflictSchema>;

// ─── 契约：仪表盘 ────────────────────────────────────────────────────────────

export const reportDashboardListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  status: reportStatusSchema.optional(),
  lifecycleStatus: reportDashboardLifecycleStatusSchema.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  favorited: queryBool('仅收藏'),
});

export const reportDashboardLookupQuery = reportLookupQuerySchema.extend({
  excludeId: z.coerce.number().int().positive().optional(),
});

/** 视图模式：auto = 有发布态优先发布态；draft / published 强制指定 */
export const reportDashboardViewQuery = z.object({
  mode: reportDashboardViewModeSchema.optional(),
});

const TAGS = ['报表仪表盘'] as const;

export const reportDashboardContract = defineContract('/api/report/dashboards', {
  list: op.get('/', { query: reportDashboardListQuery, response: paginated(reportDashboardSchema), summary: '仪表盘列表' }),
  lookup: op.get('/lookup', { query: reportDashboardLookupQuery, response: z.array(reportLookupOptionSchema), summary: '仪表盘轻量下拉' }),
  batch: op.post('/batch', { body: reportDashboardBatchSchema, response: z.array(reportDashboardSchema), summary: '批量获取仪表盘详情' }),
  batchStatus: op.put('/batch-status', { body: reportBatchStatusSchema, summary: '批量启停仪表盘' }),
  data: op.post('/{id}/data', {
    params: idParam,
    query: reportDashboardViewQuery,
    body: reportDashboardDataBodySchema,
    response: reportDashboardDataSchema,
    summary: '仪表盘批量取数',
  }),
  detail: op.get('/{id}', { params: idParam, query: reportDashboardViewQuery, response: reportDashboardSchema, summary: '仪表盘详情' }),
  create: op.post('/', { body: createReportDashboardSchema, response: reportDashboardSchema, summary: '创建仪表盘' }),
  update: op.put('/{id}', { params: idParam, body: updateReportDashboardSchema, response: reportDashboardSchema, summary: '保存仪表盘草稿' }),
  publish: op.post('/{id}/publish', { params: idParam, body: reportDashboardLifecycleActionSchema, response: reportDashboardSchema, summary: '发布仪表盘' }),
  offline: op.post('/{id}/offline', { params: idParam, body: reportDashboardLifecycleActionSchema, response: reportDashboardSchema, summary: '下线仪表盘' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除仪表盘' }),
  clone: op.post('/{id}/clone', { params: idParam, body: reportCloneSchema, response: reportDashboardSchema, summary: '复制仪表盘' }),
}, { tags: TAGS });
