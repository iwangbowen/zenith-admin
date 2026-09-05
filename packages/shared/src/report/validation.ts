import * as z from 'zod';
import { ANALYTICS_CONTEXT_MAX_BYTES, ANALYTICS_ENVIRONMENTS, ANALYTICS_EVENT_SOURCES } from '../analytics/constants';
import { errorBreadcrumbSchema } from '../analytics/validation';
import { CMS_WIDGET_RENDERER_KEYS } from '../cms/constants';
import { boundedJsonRecord, dateTimeStringSchema, httpUrl, partialForUpdate } from '../core/validation';
import { isHttpUrlTemplate, isSafeLinkUrlTemplate } from '../core/url';
import { workflowFormSchemaSchema } from '../workflow/validation';
import { REPORT_DASHBOARD_LIFECYCLE_STATUSES, REPORT_DASHBOARD_VERSION_SOURCES, REPORT_FIELD_TYPES, REPORT_FILTER_TYPES, REPORT_NOTIFY_CHANNELS, REPORT_SCHEDULE_MISFIRE_POLICIES } from './constants';
import { REPORT_ACL_ROLES, REPORT_ACL_SUBJECT_TYPES, REPORT_APPROVAL_STATUSES, REPORT_ASSET_TEMPLATE_TYPES, REPORT_CHATBI_MESSAGE_ROLES, REPORT_CHATBI_SESSION_STATUSES, REPORT_DATASOURCE_TYPES, REPORT_DQ_ANOMALY_STATUSES, REPORT_DQ_RULE_TYPES, REPORT_DQ_RUN_STATUSES, REPORT_DQ_SEVERITIES, REPORT_ENVIRONMENT_KINDS, REPORT_FILL_RECORD_STATUSES, REPORT_FILL_TEMPLATE_STATUSES, REPORT_MATERIALIZATION_STRATEGIES, REPORT_METRIC_LIFECYCLE_STATUSES, REPORT_METRIC_TYPES, REPORT_PROMOTION_STATUSES, REPORT_QUOTA_SCOPES, REPORT_RESOURCE_TYPES, REPORT_SLA_TYPES, REPORT_SLA_VIOLATION_STATUSES, REPORT_SNAPSHOT_STATUSES, REPORT_TRANSFER_STATUSES, REPORT_WIDGET_TYPES } from './types';

const timezoneSchema = z.string().min(1).max(64)
  .refine((timezone) => timezone === 'UTC' || Intl.supportedValuesOf('timeZone').includes(timezone), '时区标识无效');

export const errorReportSchema = z.object({
  errorType: z.enum(['js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash']),
  level: z.enum(['fatal', 'error', 'warning', 'info']).optional(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(16_000).optional(),
  sourceUrl: z.string().max(512).optional(),
  lineNo: z.number().int().optional(),
  colNo: z.number().int().optional(),
  pageUrl: z.string().max(512).optional(),
  release: z.string().max(64).optional(),
  sessionId: z.string().min(1).max(36).optional(),
  breadcrumbs: z.array(errorBreadcrumbSchema).max(50).optional(),
  context: boundedJsonRecord('错误上下文', 50, ANALYTICS_CONTEXT_MAX_BYTES).optional(),
  httpStatus: z.number().int().optional(),
  httpMethod: z.string().max(16).optional(),
  httpUrl: z.string().max(512).optional(),
  // 行为中心阶段 1：多端平台字段（均可选，未携带时由服务端按接入方式默认推断）
  source: z.enum(ANALYTICS_EVENT_SOURCES).optional(),
  appId: z.string().min(1).max(64).optional(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS).optional(),
});

export type ErrorReportInput = z.infer<typeof errorReportSchema>;

// ════════════════════════════════════════════════════════════════════════════
// 报表中心（Report Center）
// ════════════════════════════════════════════════════════════════════════════
export const reportDatasourceTypeSchema = z.enum(REPORT_DATASOURCE_TYPES);

export const reportFieldTypeSchema = z.enum(REPORT_FIELD_TYPES);

export const reportWidgetTypeSchema = z.enum(REPORT_WIDGET_TYPES);

/** 字段显示格式化（语义层 lite） */
export const reportFieldFormatSchema = z.object({
  kind: z.enum(['number', 'percent', 'currency', 'date', 'datetime', 'dict']),
  decimals: z.number().int().min(0).max(10).optional(),
  thousands: z.boolean().optional(),
  currencySymbol: z.string().max(8).optional(),
  prefix: z.string().max(16).optional(),
  suffix: z.string().max(16).optional(),
  dictCode: z.string().max(64).optional(),
});

/** 数据集字段（列）定义 */
const REPORT_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const REPORT_SORT_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

const REPORT_FORMULA_RESERVED = new Set(['true', 'false', 'null']);

const REPORT_FORMULA_FUNCTIONS = new Set([
  'round', 'floor', 'ceil', 'abs', 'min', 'max', 'sqrt', 'pow',
  'concat', 'upper', 'lower', 'trim', 'length', 'substr',
  'number', 'string', 'coalesce', 'ifnull', 'if', 'now',
]);

function reportIdentifierSchema(label: string, max = 128) {
  return z.string()
    .min(1, `${label}不能为空`)
    .max(max)
    .regex(REPORT_IDENTIFIER_RE, `${label}仅支持字母、数字、下划线，且不能以数字开头`)
    .refine((value) => !value.startsWith('__'), `${label}不能使用 __ 保留前缀`);
}

function uniqueReportNames(items: Array<{ name: string }>, label: string, ctx: z.RefinementCtx, path: string) {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path, index, 'name'], message: `${label}名称重复：${item.name}` });
    } else {
      seen.add(key);
    }
  }
}

function collectFormulaIdentifiers(expression: string): string[] {
  return (expression.match(/[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5.]*/g) ?? [])
    .filter((token) => !REPORT_FORMULA_RESERVED.has(token.toLowerCase()) && !REPORT_FORMULA_FUNCTIONS.has(token.toLowerCase()) && !token.includes('.'));
}

export const reportFieldSchema = z.object({
  name: reportIdentifierSchema('列名'),
  label: z.string().min(1, '显示名不能为空').max(128),
  type: reportFieldTypeSchema.default('string'),
  format: reportFieldFormatSchema.optional(),
});

/** 计算字段（衍生列）*/
export const reportComputedFieldSchema = z.object({
  name: reportIdentifierSchema('计算字段名'),
  label: z.string().min(1).max(128),
  expression: z.string().min(1, '表达式不能为空').max(512),
  type: reportFieldTypeSchema.optional(),
});

/** 数据集参数定义 */
export const reportDatasetParamSchema = z.object({
  name: reportIdentifierSchema('参数名', 64),
  label: z.string().min(1).max(64),
  type: reportFieldTypeSchema.default('string'),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

// ─── 数据源 ──────────────────────────────────────────────────────────────────
// config 形态随 type 而定（api→{url,method,headers}；sql→{connection:'internal'}），
// 这里用宽松对象，具体形态由 service 按 type 校验。
export const createReportDatasourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  ownerId: z.number().int().positive().nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  type: reportDatasourceTypeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updateReportDatasourceSchema = partialForUpdate(createReportDatasourceSchema);

export type CreateReportDatasourceInput = z.input<typeof createReportDatasourceSchema>;

export type UpdateReportDatasourceInput = z.input<typeof updateReportDatasourceSchema>;

/** 测试数据源连接（外部库）：可带 id（复用已存凭据）或完整 config */
export const reportDatasourceTestSchema = z.object({
  id: z.number().int().positive().optional(),
  type: reportDatasourceTypeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ReportDatasourceTestInput = z.input<typeof reportDatasourceTestSchema>;

export const reportLookupQuerySchema = z.object({
  keyword: z.string().max(64).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ReportLookupQueryInput = z.input<typeof reportLookupQuerySchema>;

export const reportBatchStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
  status: z.enum(['enabled', 'disabled']),
});

export type ReportBatchStatusSchemaInput = z.input<typeof reportBatchStatusSchema>;

export const reportCloneSchema = z.object({
  name: z.string().min(1).max(64).optional(),
});

export type ReportCloneSchemaInput = z.input<typeof reportCloneSchema>;

// ─── 数据集 ──────────────────────────────────────────────────────────────────
// type 由 datasource 继承，不接受用户传入；content 形态由 service 按 type 校验。
export const reportDatasetMaterializeSchema = z.object({
  enabled: z.boolean().default(false),
  cron: z.string().max(64).optional(),
  strategy: z.enum(REPORT_MATERIALIZATION_STRATEGIES).default('full'),
  keyField: reportIdentifierSchema('增量键').nullable().optional(),
  deltaWindowMinutes: z.number().int().positive().max(525_600).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.enabled && value.strategy === 'incremental' && !value.keyField) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keyField'], message: '增量物化必须指定增量键' });
  }
});

/** 行级权限规则：where 片段禁止分号（防拼接后多语句） */
export const reportRowRuleSchema = z.object({
  roles: z.array(z.string().max(64)).max(32).optional(),
  where: z.string().min(1, 'WHERE 片段不能为空').max(512).refine((s) => !s.includes(';'), 'WHERE 片段不能包含分号'),
  enabled: z.boolean().optional(),
  remark: z.string().max(128).optional(),
});

function refineDatasetDefinition(
  value: {
    fields?: Array<{ name: string }>;
    params?: Array<{ name: string }>;
    computedFields?: Array<{ name: string; expression: string }>;
  },
  ctx: z.RefinementCtx,
) {
  const fields = value.fields ?? [];
  const params = value.params ?? [];
  const computedFields = value.computedFields ?? [];
  uniqueReportNames(fields, '字段', ctx, 'fields');
  uniqueReportNames(params, '参数', ctx, 'params');
  uniqueReportNames(computedFields, '计算字段', ctx, 'computedFields');

  const fieldNames = new Set(fields.map((item) => item.name));
  const computedNames = new Set(computedFields.map((item) => item.name));
  for (const [index, item] of computedFields.entries()) {
    if (fieldNames.has(item.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['computedFields', index, 'name'], message: `计算字段名与已有字段重复：${item.name}` });
    }
    for (const ref of collectFormulaIdentifiers(item.expression)) {
      if (!fieldNames.has(ref) && !computedNames.has(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['computedFields', index, 'expression'], message: `表达式引用了未声明字段：${ref}` });
      }
    }
  }
}

const reportDatasetSchemaBase = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  ownerId: z.number().int().positive().nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  datasourceId: z.number().int().positive('请选择数据源'),
  content: z.record(z.string(), z.unknown()).default({}),
  fields: z.array(reportFieldSchema).default([]),
  params: z.array(reportDatasetParamSchema).default([]),
  computedFields: z.array(reportComputedFieldSchema).default([]),
  cacheTtl: z.number().int().min(0).max(86_400).default(0),
  materialize: reportDatasetMaterializeSchema.optional(),
  rowRules: z.array(reportRowRuleSchema).max(32).default([]),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const createReportDatasetSchema = reportDatasetSchemaBase.superRefine(refineDatasetDefinition);

export const updateReportDatasetSchema = partialForUpdate(reportDatasetSchemaBase).superRefine(refineDatasetDefinition);

export type CreateReportDatasetInput = z.input<typeof createReportDatasetSchema>;

export type UpdateReportDatasetInput = z.input<typeof updateReportDatasetSchema>;

/** 试跑预览（不落库）：用未保存的数据源+content 直接取数 */
export const reportDatasetPreviewSchema = z.object({
  datasourceId: z.number().int().positive('请选择数据源'),
  content: z.record(z.string(), z.unknown()).default({}),
  params: z.record(z.string(), z.unknown()).optional(),
  computedFields: z.array(reportComputedFieldSchema).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export type ReportDatasetPreviewInput = z.input<typeof reportDatasetPreviewSchema>;

// ─── 仪表盘 ──────────────────────────────────────────────────────────────────
export const reportGridItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  minW: z.number().int().min(1).optional(),
  minH: z.number().int().min(1).optional(),
});

export const reportCanvasItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  z: z.number().int().optional(),
});

export const reportWidgetSchema = z.object({
  i: z.string().min(1),
  type: reportWidgetTypeSchema,
  title: z.string().max(128).default(''),
  datasetId: z.number().int().positive().nullable().optional(),
  metricId: z.number().int().positive().nullable().optional(),
  options: z.record(z.string(), z.unknown()).default({}),
  paramBindings: z.array(z.object({ filterId: z.string(), param: z.string() })).optional(),
  interaction: z.object({ enabled: z.boolean().optional(), setFilterId: z.string().optional() }).optional(),
  drilldown: z.object({
    enabled: z.boolean().optional(),
    type: z.enum(['fields', 'dashboard', 'url']).optional(),
    fields: z.array(z.string()).optional(),
    targetDashboardId: z.number().int().positive().nullable().optional(),
    /** 外链下钻模板（`{value}` 占位）：只允许 http(s)，杜绝 javascript: / data: 存储型 XSS */
    url: z.string().max(2048).refine((value) => value === '' || isHttpUrlTemplate(value), '下钻地址仅支持 http(s) URL').optional(),
    paramName: z.string().optional(),
  }).optional(),
  style: z.object({ background: z.string().optional(), showHeader: z.boolean().optional(), borderless: z.boolean().optional() }).optional(),
  page: z.number().int().min(1).max(50).optional(),
}).superRefine((value, ctx) => {
  // image / iframe 组件的 src 会被直接渲染：iframe 只允许 http(s)，图片额外允许站内路径（`${filter}` 占位先行替换）
  if ((value.type === 'image' || value.type === 'iframe') && typeof value.options.src === 'string' && value.options.src.trim()) {
    const src = value.options.src.trim();
    const ok = value.type === 'iframe' ? isHttpUrlTemplate(src) : isSafeLinkUrlTemplate(src);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', 'src'],
        message: value.type === 'iframe' ? '网页地址仅支持 http(s) URL' : '图片地址仅支持 http(s) URL 或站内路径',
      });
    }
  }
  if (!value.metricId) return;
  if (value.datasetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetId'], message: '指标组件不能同时绑定数据集' });
  }
  if (!['kpi', 'gauge', 'flipper', 'liquid'].includes(value.type)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['metricId'], message: '当前组件类型不支持指标数据源' });
  }
});

export const reportFilterTypeSchema = z.enum(REPORT_FILTER_TYPES);

export const reportFilterSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(64),
  type: reportFilterTypeSchema,
  defaultValue: z.unknown().optional(),
  optionSource: z.object({
    kind: z.enum(['static', 'dataset']),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    datasetId: z.number().int().positive().nullable().optional(),
    valueField: z.string().optional(),
    labelField: z.string().optional(),
  }).optional(),
  width: z.number().int().min(1).max(24).optional(),
});

export const reportScreenConfigSchema = z.object({
  width: z.number().int().min(320).max(10000),
  height: z.number().int().min(240).max(10000),
  background: z.string().optional(),
  backgroundImage: z.string().max(2_000_000, '套打背景图不能超过 2MB').optional(),
  scaleMode: z.enum(['fit', 'width', 'full']).optional(),
});

export const reportDashboardConfigSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  layoutMode: z.enum(['grid', 'canvas']).optional(),
  screen: z.boolean().optional(),
  screenConfig: reportScreenConfigSchema.optional(),
  refreshInterval: z.number().int().min(0).optional(),
  carousel: z.object({
    enabled: z.boolean().optional(),
    pageCount: z.number().int().min(1).max(50).optional(),
    intervalSec: z.number().int().min(0).max(3600).optional(),
    showDots: z.boolean().optional(),
  }).optional(),
  embed: z.object({
    allowedOrigins: z.array(httpUrl().max(2048).refine((value) => {
      try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:')
          && !url.username
          && !url.password
          && !url.search
          && !url.hash
          && (url.pathname === '' || url.pathname === '/');
      } catch {
        return false;
      }
    }, '必须是精确的 http(s) Origin')).max(50).optional(),
    readOnly: z.boolean().optional(),
  }).optional(),
});

export const reportDashboardLifecycleStatusSchema = z.enum(REPORT_DASHBOARD_LIFECYCLE_STATUSES);

export const createReportDashboardSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  ownerId: z.number().int().positive().nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  layout: z.array(reportGridItemSchema).default([]),
  canvasLayout: z.array(reportCanvasItemSchema).default([]),
  widgets: z.array(reportWidgetSchema).default([]),
  filters: z.array(reportFilterSchema).default([]),
  config: reportDashboardConfigSchema.default({}),
  categoryId: z.number().int().positive().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updateReportDashboardSchema = partialForUpdate(createReportDashboardSchema).extend({
  expectedRevision: z.number().int().positive(),
});

export type CreateReportDashboardInput = z.input<typeof createReportDashboardSchema>;

export type UpdateReportDashboardInput = z.input<typeof updateReportDashboardSchema>;

export const reportDashboardViewModeSchema = z.enum(['auto', 'draft', 'published']).default('auto');

/** 批量获取仪表盘详情（视图模式随查询） */
export const reportDashboardBatchSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
  mode: reportDashboardViewModeSchema.optional(),
});

export type ReportDashboardBatchInput = z.input<typeof reportDashboardBatchSchema>;

/** 预警 / 订阅的批量启停（enabled 布尔而非 status 枚举） */
export const reportBatchEnabledSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
  enabled: z.boolean(),
});

export type ReportBatchEnabledInput = z.input<typeof reportBatchEnabledSchema>;

export const reportDashboardLifecycleActionSchema = z.object({
  expectedRevision: z.number().int().positive(),
  remark: z.string().max(256).optional(),
});

export type ReportDashboardLifecycleActionInput = z.input<typeof reportDashboardLifecycleActionSchema>;

// ─── 取数（带参数）──────────────────────────────────────────────────────────
export const reportDatasetQuerySchema = z.object({
  limit: z.number().int().min(1).max(5000).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  sortField: z.string().regex(REPORT_SORT_FIELD_RE, '排序字段格式不正确').optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  timeoutMs: z.number().int().min(100).max(300_000).optional(),
  maxRows: z.number().int().positive().max(1_000_000).optional(),
  maxBytes: z.number().int().positive().max(1_073_741_824).optional(),
  concurrencyKey: z.string().min(1).max(128).optional(),
  quotaKey: z.string().min(1).max(128).optional(),
}).superRefine((value, ctx) => {
  const hasPaging = value.page !== undefined || value.pageSize !== undefined;
  if (hasPaging && (value.page === undefined || value.pageSize === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'page 与 pageSize 需同时提供', path: [value.page === undefined ? 'page' : 'pageSize'] });
  }
});

export const reportDatasetDataBodySchema = reportDatasetQuerySchema.extend({
  params: z.record(z.string(), z.unknown()).optional(),
});

export type ReportDatasetQueryOptions = z.output<typeof reportDatasetQuerySchema>;

export type ReportDatasetDataInput = z.input<typeof reportDatasetDataBodySchema>;

export const reportDashboardDataBodySchema = z.object({
  filters: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  widgetQueries: z.record(z.string(), reportDatasetQuerySchema).optional(),
});

export type ReportDashboardDataInput = z.input<typeof reportDashboardDataBodySchema>;

// ─── 仪表盘分类 ──────────────────────────────────────────────────────────────
export const createReportCategorySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  sort: z.number().int().default(0),
  remark: z.string().max(256).optional(),
});

export const updateReportCategorySchema = partialForUpdate(createReportCategorySchema);

export type CreateReportCategoryInput = z.input<typeof createReportCategorySchema>;

export type UpdateReportCategoryInput = z.input<typeof updateReportCategorySchema>;

export const reportExecutionStatsQuerySchema = z.object({
  datasetId: z.coerce.number().int().positive().optional(),
  datasourceId: z.coerce.number().int().positive().optional(),
  dashboardId: z.coerce.number().int().positive().optional(),
  scene: z.string().max(32).optional(),
  // 查询串布尔:不能用 z.coerce.boolean()('false' 会变 true);空串视为未传
  success: z.union([z.literal('').transform(() => undefined), z.stringbool()]).optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

export type ReportExecutionStatsQueryInput = z.input<typeof reportExecutionStatsQuerySchema>;

// ─── 版本 ──────────────────────────────────────────────────────────────────
export const createReportVersionSchema = z.object({ remark: z.string().max(256).optional() });

export type CreateReportVersionInput = z.input<typeof createReportVersionSchema>;

export const reportVersionDiffQuerySchema = z.object({
  left: z.number().int().min(0),
  right: z.number().int().min(0),
});

export const restoreReportVersionSchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export const reportDashboardVersionSourceSchema = z.enum(REPORT_DASHBOARD_VERSION_SOURCES);

// ─── 公开分享 ────────────────────────────────────────────────────────────────
export const createReportShareSchema = z.object({
  /** 过期时间：不传=默认 30 天；null=永久有效 */
  expireAt: dateTimeStringSchema.nullable().optional(),
  password: z.string().min(8, '访问密码至少 8 位').max(64).optional(),
  enabled: z.boolean().default(true),
  maxAccessCount: z.number().int().positive().nullable().optional(),
  allowedCidrs: z.array(z.string().min(1).max(64)).max(50).optional(),
  allowedIps: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export const updateReportShareSchema = z.object({
  expireAt: dateTimeStringSchema.nullable().optional(),
  password: z.string().min(8, '访问密码至少 8 位').max(64).nullable().optional(),
  enabled: z.boolean().optional(),
  maxAccessCount: z.number().int().positive().nullable().optional(),
  allowedCidrs: z.array(z.string().min(1).max(64)).max(50).optional(),
  allowedIps: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export type CreateReportShareInput = z.input<typeof createReportShareSchema>;

export type UpdateReportShareInput = z.input<typeof updateReportShareSchema>;

export const reportPublicAccessSchema = z.object({
  password: z.string().min(8).max(64).optional(),
});

export type ReportPublicAccessInput = z.input<typeof reportPublicAccessSchema>;

export const reportPublicSessionHeaderSchema = z.object({
  session: z.string().min(16),
});

export const createReportEmbedTokenSchema = z.object({
  allowedFilterIds: z.array(z.string().min(1).max(64)).max(100).default([]),
  fixedFilters: z.record(z.string(), z.unknown()).default({}),
  expireAt: dateTimeStringSchema.nullable().optional(),
  remark: z.string().max(256).optional(),
});

export const revokeReportEmbedTokenSchema = z.object({});

export type CreateReportEmbedTokenInput = z.input<typeof createReportEmbedTokenSchema>;

// ─── 订阅推送 ────────────────────────────────────────────────────────────────
export const reportNotifyChannelSchema = z.enum(REPORT_NOTIFY_CHANNELS);

export const reportScheduleMisfirePolicySchema = z.enum(REPORT_SCHEDULE_MISFIRE_POLICIES);

export const createReportSubscriptionSchema = z.object({
  dashboardId: z.number().int().positive(),
  cron: z.string().min(1, '请填写 Cron 表达式').max(64),
  timezone: z.string().min(1, '请选择时区').max(64).default('Asia/Shanghai'),
  misfirePolicy: reportScheduleMisfirePolicySchema.default('fire_once'),
  channels: z.array(reportNotifyChannelSchema).min(1, '至少选择一个推送通道'),
  recipients: z.string().max(512).optional(),
  webhookUrl: httpUrl('Webhook 地址必须是合法的 http(s) URL').max(512).nullable().optional(),
  enabled: z.boolean().default(true),
  remark: z.string().max(256).optional(),
});

export const updateReportSubscriptionSchema = partialForUpdate(createReportSubscriptionSchema).extend({
  webhookUrl: z.union([httpUrl('Webhook 地址必须是合法的 http(s) URL').max(512), z.literal('******')]).nullable().optional(),
});

export type CreateReportSubscriptionInput = z.input<typeof createReportSubscriptionSchema>;

export type UpdateReportSubscriptionInput = z.input<typeof updateReportSubscriptionSchema>;

// ─── 类 Excel 打印报表 ────────────────────────────────────────────────────────
export const reportPrintCellStyleSchema = z.object({
  fontFamily: z.string().max(128).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  background: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  valign: z.enum(['top', 'middle', 'bottom']).optional(),
  border: z.union([
    z.boolean(),
    z.object({
      top: z.object({ style: z.enum(['thin', 'medium', 'dashed', 'dotted', 'double']).optional(), color: z.string().optional() }).optional(),
      right: z.object({ style: z.enum(['thin', 'medium', 'dashed', 'dotted', 'double']).optional(), color: z.string().optional() }).optional(),
      bottom: z.object({ style: z.enum(['thin', 'medium', 'dashed', 'dotted', 'double']).optional(), color: z.string().optional() }).optional(),
      left: z.object({ style: z.enum(['thin', 'medium', 'dashed', 'dotted', 'double']).optional(), color: z.string().optional() }).optional(),
    }),
  ]).optional(),
  wrap: z.boolean().optional(),
});

export const reportPrintCellSchema = z.object({
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  v: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  s: reportPrintCellStyleSchema.optional(),
  kind: z.enum(['text', 'formula', 'image', 'qrcode', 'barcode', 'subreport']).optional(),
  formula: z.string().max(2048).optional(),
  numFmt: z.string().max(128).optional(),
  image: z.object({
    src: z.string().min(1).max(2800000),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    fit: z.enum(['contain', 'cover']).optional(),
    alt: z.string().max(256).optional(),
  }).optional(),
  datasetKey: reportIdentifierSchema('数据集绑定键', 64).optional(),
  subreport: z.object({
    templateId: z.number().int().positive(),
    datasetKey: reportIdentifierSchema('子报表数据集绑定键', 64).optional(),
    paramBindings: z.record(
      reportIdentifierSchema('子报表参数名'),
      reportIdentifierSchema('父模板参数名'),
    ).optional(),
  }).optional(),
});

export const reportPrintMergeSchema = z.object({
  row: z.number().int().min(0), col: z.number().int().min(0),
  rowSpan: z.number().int().min(1), colSpan: z.number().int().min(1),
});

export const reportPrintGridSchema = z.object({
  rows: z.number().int().min(0).max(5000),
  cols: z.number().int().min(0).max(300),
  colWidths: z.array(z.number()).optional(),
  rowHeights: z.array(z.number()).optional(),
  cells: z.array(reportPrintCellSchema).max(100000).default([]),
  merges: z.array(reportPrintMergeSchema).max(10000).optional(),
}).superRefine((value, ctx) => {
  value.cells.forEach((cell, index) => {
    if (cell.row >= value.rows || cell.col >= value.cols) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index], message: '单元格坐标超出网格范围' });
    }
  });
  (value.merges ?? []).forEach((merge, index) => {
    if (merge.row + merge.rowSpan > value.rows || merge.col + merge.colSpan > value.cols) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['merges', index], message: '合并区域超出网格范围' });
    }
  });
});

export const reportPrintRowRangeSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
}).refine((value) => value.end >= value.start, { message: '结束行不能小于开始行' });

export const reportPrintPageConfigSchema = z.object({
  paper: z.enum(['A4', 'A3', 'A5', 'Letter']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margin: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
  header: z.string().max(512).optional(),
  footer: z.string().max(512).optional(),
  backgroundImage: z.string().max(2800000).optional(),
  pageBreaks: z.array(z.number().int().positive()).optional(),
  repeatHeaderRows: reportPrintRowRangeSchema.nullable().optional(),
  rowsPerPage: z.number().int().positive().max(10000).optional(),
  calculateRowsPerPage: z.boolean().optional(),
  detailDirection: z.enum(['vertical', 'horizontal', 'crosstab']).optional(),
  crosstab: z.object({
    rowFields: z.array(reportIdentifierSchema('交叉表行字段')).min(1).max(20),
    columnFields: z.array(reportIdentifierSchema('交叉表列字段')).min(1).max(20),
    valueFields: z.array(z.object({
      field: reportIdentifierSchema('交叉表值字段'),
      aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count']),
      label: z.string().min(1).max(128).optional(),
    })).min(1).max(20).optional(),
    valueField: reportIdentifierSchema('交叉表值字段').optional(),
    aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count']).optional(),
    showRowTotals: z.boolean().optional(),
    showColumnTotals: z.boolean().optional(),
    emptyValue: z.union([z.string(), z.number(), z.null()]).optional(),
    nullLabel: z.string().max(128).optional(),
    headerRow: z.number().int().min(0).optional(),
    dataRow: z.number().int().min(0).optional(),
    totalRow: z.number().int().min(0).optional(),
    startColumn: z.number().int().min(0).optional(),
  }).superRefine((value, ctx) => {
    if (!value.valueFields?.length && (!value.valueField || !value.aggregate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueFields'], message: '交叉表至少需要一个值字段' });
    }
  }).optional(),
  groupByFields: z.array(z.string().min(1).max(128)).optional(),
  groupHeaderRows: reportPrintRowRangeSchema.nullable().optional(),
  groupFooterRows: reportPrintRowRangeSchema.nullable().optional(),
  pageSubtotalRows: reportPrintRowRangeSchema.nullable().optional(),
  totalRows: reportPrintRowRangeSchema.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.detailDirection === 'crosstab' && !value.crosstab) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['crosstab'], message: '交叉表方向必须提供交叉表配置' });
  }
});

export const reportPrintSheetSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  datasetKey: reportIdentifierSchema('Sheet 数据集绑定键', 64).optional(),
  grid: reportPrintGridSchema,
  pageConfig: reportPrintPageConfigSchema.optional(),
  repeatBlocks: z.array(z.object({
    id: reportIdentifierSchema('重复块 ID', 64),
    datasetKey: reportIdentifierSchema('重复块数据集绑定键', 64),
    range: reportPrintRowRangeSchema,
  })).max(32).optional(),
});

export const reportPrintContentSchema = z.object({
  workbook: z.unknown().optional(),
  grid: reportPrintGridSchema.optional(),
  sheets: z.array(reportPrintSheetSchema).optional(),
  datasetBindings: z.array(z.object({
    key: reportIdentifierSchema('数据集绑定键', 64),
    datasetId: z.number().int().positive(),
    params: z.record(z.string(), z.unknown()).optional(),
    paramBindings: z.record(
      reportIdentifierSchema('目标数据集参数名'),
      reportIdentifierSchema('打印模板参数名'),
    ).optional(),
    rowLimit: z.number().int().min(1).max(5000).optional(),
    parentKey: reportIdentifierSchema('父数据集绑定键', 64).nullable().optional(),
    parentField: reportIdentifierSchema('父关联字段').nullable().optional(),
    childField: reportIdentifierSchema('子关联字段').nullable().optional(),
  })).max(32).optional(),
}).superRefine((value, ctx) => {
  const bindings = value.datasetBindings ?? [];
  const keys = new Set<string>();
  for (const [index, binding] of bindings.entries()) {
    const normalizedKey = binding.key.toLowerCase();
    if (normalizedKey === 'main' || normalizedKey.startsWith('__')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetBindings', index, 'key'], message: '数据集绑定键不能使用保留名称 main 或 __ 前缀' });
    }
    if (keys.has(normalizedKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetBindings', index, 'key'], message: '数据集绑定键不能重复' });
    }
    keys.add(normalizedKey);
    const relationFields = [binding.parentKey, binding.parentField, binding.childField];
    const relationFieldCount = relationFields.filter((field) => field != null).length;
    if (relationFieldCount !== 0 && relationFieldCount !== 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetBindings', index], message: '父子数据集关联必须同时提供父 key、父字段和子字段' });
    }
    if (binding.parentKey && binding.parentKey.toLowerCase() !== 'main' && !bindings.some((item) => item.key.toLowerCase() === binding.parentKey?.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetBindings', index, 'parentKey'], message: '父数据集绑定不存在' });
    }
    if (binding.parentKey?.toLowerCase() === normalizedKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetBindings', index, 'parentKey'], message: '数据集绑定不能关联自身' });
    }
  }
  for (const [index, sheet] of (value.sheets ?? []).entries()) {
    const validKeys = new Set(['main', ...keys]);
    if (sheet.datasetKey && !validKeys.has(sheet.datasetKey.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheets', index, 'datasetKey'], message: 'Sheet 引用了不存在的数据集绑定' });
    }
    const repeatIds = new Set<string>();
    for (const [blockIndex, block] of (sheet.repeatBlocks ?? []).entries()) {
      if (!validKeys.has(block.datasetKey.toLowerCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheets', index, 'repeatBlocks', blockIndex, 'datasetKey'], message: '重复块引用了不存在的数据集绑定' });
      }
      if (block.range.end >= sheet.grid.rows) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheets', index, 'repeatBlocks', blockIndex, 'range'], message: '重复块行范围超出 Sheet 网格' });
      }
      const normalizedId = block.id.toLowerCase();
      if (repeatIds.has(normalizedId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheets', index, 'repeatBlocks', blockIndex, 'id'], message: '重复块 ID 不能重复' });
      }
      repeatIds.add(normalizedId);
      if ((sheet.repeatBlocks ?? []).slice(0, blockIndex).some((other) =>
        block.range.start <= other.range.end && other.range.start <= block.range.end)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheets', index, 'repeatBlocks', blockIndex, 'range'], message: '重复块行范围不能重叠' });
      }
    }
    for (const [cellIndex, cell] of sheet.grid.cells.entries()) {
      for (const [path, referencedKey] of [['datasetKey', cell.datasetKey], ['subreport', cell.subreport?.datasetKey]] as const) {
        if (referencedKey && !validKeys.has(referencedKey.toLowerCase())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheets', index, 'grid', 'cells', cellIndex, path], message: '单元格引用了不存在的数据集绑定' });
        }
      }
    }
  }
});

export const createReportPrintTemplateSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  ownerId: z.number().int().positive().nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  datasetId: z.number().int().positive().nullable().optional(),
  content: reportPrintContentSchema.default({}),
  params: z.array(reportDatasetParamSchema).default([]),
  pageConfig: reportPrintPageConfigSchema.default({}),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(256).optional(),
});

export const updateReportPrintTemplateSchema = partialForUpdate(createReportPrintTemplateSchema);

export type CreateReportPrintTemplateInput = z.input<typeof createReportPrintTemplateSchema>;

export type UpdateReportPrintTemplateInput = z.input<typeof updateReportPrintTemplateSchema>;

/** 渲染（取数填充）入参 */
export const reportPrintRenderSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export type ReportPrintRenderInput = z.input<typeof reportPrintRenderSchema>;

// ─── AI 自然语言取数（NL2SQL）────────────────────────────────────────────────
export const reportNl2SqlSchema = z.object({
  question: z.string().min(1, '请描述你想查询的数据').max(1000),
  datasetId: z.number().int().positive().optional(),
});

export type ReportNl2SqlInput = z.input<typeof reportNl2SqlSchema>;

// ─── 数据预警 ────────────────────────────────────────────────────────────────
const reportAlertSchemaBase = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  datasetId: z.number().int().positive('请选择数据集').nullable().optional(),
  metricId: z.number().int().positive('请选择指标').nullable().optional(),
  field: z.string().max(128).nullable().optional(),
  /** 分组维度（可空=全局聚合；有值=按组聚合，任一组命中即触发） */
  groupByField: z.string().max(128).nullable().optional(),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'first']).default('sum'),
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']).default('gt'),
  threshold: z.number(),
  cron: z.string().max(64).nullable().optional(),
  timezone: z.string().min(1, '请选择时区').max(64).default('Asia/Shanghai'),
  misfirePolicy: reportScheduleMisfirePolicySchema.default('fire_once'),
  channels: z.array(reportNotifyChannelSchema).min(1, '至少选择一个通知通道'),
  recipients: z.string().max(512).optional(),
  webhookUrl: httpUrl('Webhook 地址必须是合法的 http(s) URL').max(512).nullable().optional(),
  /** 静默期（分钟）：持续触发时距上次通知不足该时长不重复通知；0=每次触发都通知（上限 7 天） */
  silenceMins: z.number().int().min(0).max(10080).default(60),
  /** 从触发恢复正常时是否发送恢复通知 */
  notifyOnRecover: z.boolean().default(false),
  enabled: z.boolean().default(true),
  remark: z.string().max(256).optional(),
});

function refineReportAlertSource(
  value: { datasetId?: number | null; metricId?: number | null; groupByField?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!value.datasetId && !value.metricId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datasetId'], message: '数据集或指标必须选择一个' });
  }
  if (value.datasetId && value.metricId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['metricId'], message: '数据集与指标不能同时选择' });
  }
  if (value.metricId && value.groupByField) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupByField'], message: '指标预警不支持分组' });
  }
}

export const createReportAlertSchema = reportAlertSchemaBase.superRefine(refineReportAlertSource);

export const updateReportAlertSchema = partialForUpdate(reportAlertSchemaBase).extend({
  webhookUrl: z.union([httpUrl('Webhook 地址必须是合法的 http(s) URL').max(512), z.literal('******')]).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.datasetId !== undefined || value.metricId !== undefined) refineReportAlertSource(value, ctx);
  if (value.metricId && value.groupByField) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groupByField'], message: '指标预警不支持分组' });
  }
});

export type CreateReportAlertInput = z.input<typeof createReportAlertSchema>;

export type UpdateReportAlertInput = z.input<typeof updateReportAlertSchema>;

export const acknowledgeReportDeliveryRunSchema = z.object({
  note: z.string().max(500).optional(),
});

export type AcknowledgeReportDeliveryRunInput = z.input<typeof acknowledgeReportDeliveryRunSchema>;

// ─── 仪表盘评论 ──────────────────────────────────────────────────────────────
export const createReportCommentSchema = z.object({
  widgetId: z.string().max(64).nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  content: z.string().min(1, '评论内容不能为空').max(1000),
});

export type CreateReportCommentInput = z.input<typeof createReportCommentSchema>;

export const updateReportCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(1000),
});

export const resolveReportCommentSchema = z.object({
  resolved: z.boolean(),
});

export const reportCommentListQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  widgetId: z.string().max(64).optional(),
});

// ─── 报表平台化 P2 ────────────────────────────────────────────────────────────
export const reportResourceTypeSchema = z.enum(REPORT_RESOURCE_TYPES);

export const reportMetricTypeSchema = z.enum(REPORT_METRIC_TYPES);

export const reportMetricLifecycleStatusSchema = z.enum(REPORT_METRIC_LIFECYCLE_STATUSES);

export const reportAclSubjectTypeSchema = z.enum(REPORT_ACL_SUBJECT_TYPES);

export const reportAclRoleSchema = z.enum(REPORT_ACL_ROLES);

export const reportApprovalStatusSchema = z.enum(REPORT_APPROVAL_STATUSES);

export const reportTransferStatusSchema = z.enum(REPORT_TRANSFER_STATUSES);

export const reportEnvironmentKindSchema = z.enum(REPORT_ENVIRONMENT_KINDS);

export const reportPromotionStatusSchema = z.enum(REPORT_PROMOTION_STATUSES);

export const reportDqRuleTypeSchema = z.enum(REPORT_DQ_RULE_TYPES);

export const reportDqSeveritySchema = z.enum(REPORT_DQ_SEVERITIES);

export const reportDqRunStatusSchema = z.enum(REPORT_DQ_RUN_STATUSES);

export const reportDqAnomalyStatusSchema = z.enum(REPORT_DQ_ANOMALY_STATUSES);

export const reportMaterializationStrategySchema = z.enum(REPORT_MATERIALIZATION_STRATEGIES);

export const reportSnapshotStatusSchema = z.enum(REPORT_SNAPSHOT_STATUSES);

export const reportQuotaScopeSchema = z.enum(REPORT_QUOTA_SCOPES);

export const reportSlaTypeSchema = z.enum(REPORT_SLA_TYPES);

export const reportSlaViolationStatusSchema = z.enum(REPORT_SLA_VIOLATION_STATUSES);

export const reportAssetTemplateTypeSchema = z.enum(REPORT_ASSET_TEMPLATE_TYPES);

export const reportChatbiSessionStatusSchema = z.enum(REPORT_CHATBI_SESSION_STATUSES);

export const reportChatbiMessageRoleSchema = z.enum(REPORT_CHATBI_MESSAGE_ROLES);

export const reportFillTemplateStatusSchema = z.enum(REPORT_FILL_TEMPLATE_STATUSES);

export const reportFillRecordStatusSchema = z.enum(REPORT_FILL_RECORD_STATUSES);

const reportResourceRefSchema = z.object({
  resourceType: reportResourceTypeSchema,
  resourceId: z.number().int().positive(),
});

export const reportPlatformListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  keyword: z.string().trim().max(128).optional(),
  resourceType: reportResourceTypeSchema.optional(),
  folderId: z.coerce.number().int().positive().nullable().optional(),
  ownerId: z.coerce.number().int().positive().nullable().optional(),
  status: z.string().max(32).optional(),
  startAt: dateTimeStringSchema.optional(),
  endAt: dateTimeStringSchema.optional(),
});

export type ReportPlatformListQueryInput = z.input<typeof reportPlatformListQuerySchema>;

export const createReportFolderSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1, '名称不能为空').max(64),
  resourceType: reportResourceTypeSchema,
  ownerId: z.number().int().positive().nullable().optional(),
  sort: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateReportFolderSchema = partialForUpdate(createReportFolderSchema).omit({ resourceType: true });

export const moveReportFolderSchema = z.object({
  parentId: z.number().int().positive().nullable(),
  sort: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});

export type CreateReportFolderInput = z.input<typeof createReportFolderSchema>;

export type UpdateReportFolderInput = z.input<typeof updateReportFolderSchema>;

export type MoveReportFolderInput = z.input<typeof moveReportFolderSchema>;

const reportMetricSchemaBase = z.object({
  folderId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  code: reportIdentifierSchema('指标编码', 64),
  name: z.string().trim().min(1).max(128),
  description: z.string().max(1000).nullable().optional(),
  type: reportMetricTypeSchema,
  datasetId: z.number().int().positive(),
  sourceField: reportIdentifierSchema('来源字段').nullable().optional(),
  formula: z.string().trim().min(1).max(2000).nullable().optional(),
  aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'distinct_count']).nullable().optional(),
  dimensions: z.array(reportIdentifierSchema('维度字段')).max(32).default([]),
  timeField: reportIdentifierSchema('时间字段').nullable().optional(),
  unit: z.string().max(32).nullable().optional(),
  format: z.string().max(128).nullable().optional(),
  caliber: z.string().max(2000).nullable().optional(),
});

function refineReportMetric(
  value: { type?: z.infer<typeof reportMetricTypeSchema>; sourceField?: string | null; formula?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.type === 'simple' && !value.sourceField) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceField'], message: '简单指标必须指定来源字段' });
  }
  if ((value.type === 'ratio' || value.type === 'composite') && !value.formula) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['formula'], message: '比率或复合指标必须填写公式' });
  }
}

export const createReportMetricSchema = reportMetricSchemaBase.superRefine(refineReportMetric);

export const updateReportMetricSchema = partialForUpdate(reportMetricSchemaBase).extend({
  expectedRevision: z.number().int().positive(),
}).superRefine(refineReportMetric);

export const reportMetricLifecycleActionSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export const reportMetricEvaluateSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
});

export type CreateReportMetricInput = z.input<typeof createReportMetricSchema>;

export type UpdateReportMetricInput = z.input<typeof updateReportMetricSchema>;

export type ReportMetricLifecycleActionInput = z.input<typeof reportMetricLifecycleActionSchema>;

export const grantReportResourceAclSchema = reportResourceRefSchema.extend({
  subjectType: reportAclSubjectTypeSchema,
  subjectId: z.number().int().positive(),
  role: reportAclRoleSchema,
  inheritFromFolder: z.boolean().default(false),
  expiresAt: dateTimeStringSchema.nullable().optional(),
});

/** 检查当前用户对某资源是否具备指定角色 */
export const checkReportResourceAccessSchema = reportResourceRefSchema.extend({
  requiredRole: reportAclRoleSchema,
});

export type CheckReportResourceAccessInput = z.input<typeof checkReportResourceAccessSchema>;

export const updateReportResourceAclSchema = partialForUpdate(grantReportResourceAclSchema
  .pick({ role: true, inheritFromFolder: true, expiresAt: true }));

export const revokeReportResourceAclSchema = z.object({ reason: z.string().max(500).optional() });

export type GrantReportResourceAclInput = z.input<typeof grantReportResourceAclSchema>;

export type UpdateReportResourceAclInput = z.input<typeof updateReportResourceAclSchema>;

export const createReportPublishApprovalSchema = reportResourceRefSchema.extend({
  action: z.enum(['publish', 'promote', 'deprecate']),
  requestedRevision: z.number().int().positive(),
  snapshot: z.record(z.string(), z.unknown()),
  note: z.string().max(500).optional(),
});

export const decideReportPublishApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
});

export const cancelReportPublishApprovalSchema = z.object({ reason: z.string().max(500).optional() });

export type CreateReportPublishApprovalInput = z.input<typeof createReportPublishApprovalSchema>;

export type DecideReportPublishApprovalInput = z.input<typeof decideReportPublishApprovalSchema>;

export const createReportResourceTransferSchema = reportResourceRefSchema.extend({
  toOwnerId: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export const decideReportResourceTransferSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  note: z.string().max(500).optional(),
});

export const cancelReportResourceTransferSchema = z.object({ reason: z.string().max(500).optional() });

export type CreateReportResourceTransferInput = z.input<typeof createReportResourceTransferSchema>;

export type DecideReportResourceTransferInput = z.input<typeof decideReportResourceTransferSchema>;

export const createReportEnvironmentSchema = z.object({
  code: reportIdentifierSchema('环境编码', 64),
  name: z.string().trim().min(1).max(128),
  kind: reportEnvironmentKindSchema,
  description: z.string().max(500).nullable().optional(),
  baseUrl: httpUrl('环境地址必须是合法的 http(s) URL').max(1024).nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().default(false),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateReportEnvironmentSchema = partialForUpdate(createReportEnvironmentSchema).omit({ code: true });

export type CreateReportEnvironmentInput = z.input<typeof createReportEnvironmentSchema>;

export type UpdateReportEnvironmentInput = z.input<typeof updateReportEnvironmentSchema>;

export const createReportEnvironmentPromotionSchema = reportResourceRefSchema.extend({
  sourceEnvironmentId: z.number().int().positive(),
  targetEnvironmentId: z.number().int().positive(),
  sourceRevision: z.number().int().positive(),
  sourceSnapshot: z.record(z.string(), z.unknown()),
}).refine((value) => value.sourceEnvironmentId !== value.targetEnvironmentId, {
  path: ['targetEnvironmentId'],
  message: '目标环境不能与来源环境相同',
});

export const reportEnvironmentPromotionActionSchema = z.object({
  action: z.enum(['approve', 'deploy', 'cancel', 'rollback']),
  note: z.string().max(1000).optional(),
  expectedStatus: reportPromotionStatusSchema,
});

export type CreateReportEnvironmentPromotionInput = z.input<typeof createReportEnvironmentPromotionSchema>;

export type ReportEnvironmentPromotionActionInput = z.input<typeof reportEnvironmentPromotionActionSchema>;

export const reportDqRuleConfigSchema = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  pattern: z.string().max(1000).nullable().optional(),
  maxAgeMinutes: z.number().int().positive().max(525_600).nullable().optional(),
  minRows: z.number().int().nonnegative().nullable().optional(),
  maxRows: z.number().int().nonnegative().nullable().optional(),
  sql: z.string().trim().min(1).max(10_000).nullable().optional(),
});

const reportDqRuleSchemaBase = z.object({
  datasetId: z.number().int().positive(),
  name: z.string().trim().min(1).max(128),
  type: reportDqRuleTypeSchema,
  field: reportIdentifierSchema('质量规则字段').nullable().optional(),
  severity: reportDqSeveritySchema.default('medium'),
  config: reportDqRuleConfigSchema.default({}),
  cron: z.string().max(64).nullable().optional(),
  timezone: timezoneSchema.default('Asia/Shanghai'),
  enabled: z.boolean().default(true),
});

function refineReportDqRule(
  value: { type?: z.infer<typeof reportDqRuleTypeSchema>; field?: string | null; config?: z.infer<typeof reportDqRuleConfigSchema> },
  ctx: z.RefinementCtx,
) {
  const config = value.config ?? {};
  if (value.type && !['row_count', 'custom_sql'].includes(value.type) && !value.field) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['field'], message: '该质量规则必须指定字段' });
  }
  if (value.type === 'range' && config.min == null && config.max == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config'], message: '范围规则至少指定一个边界' });
  }
  if (value.type === 'pattern' && !config.pattern) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'pattern'], message: '模式规则必须提供正则表达式' });
  }
  if (value.type === 'freshness' && !config.maxAgeMinutes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'maxAgeMinutes'], message: '新鲜度规则必须提供最大延迟' });
  }
  if (value.type === 'custom_sql' && !config.sql) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'sql'], message: '自定义 SQL 规则必须提供 SQL' });
  }
  if (config.min != null && config.max != null && config.min > config.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'max'], message: '上界不能小于下界' });
  }
}

export const createReportDqRuleSchema = reportDqRuleSchemaBase.superRefine(refineReportDqRule);

export const updateReportDqRuleSchema = partialForUpdate(reportDqRuleSchemaBase).superRefine(refineReportDqRule);

export const runReportDqRuleSchema = z.object({ sampleLimit: z.number().int().min(0).max(100).default(20) });

export const updateReportDqAnomalyStatusSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'ignored']),
  note: z.string().max(1000).optional(),
});

export type CreateReportDqRuleInput = z.input<typeof createReportDqRuleSchema>;

export type UpdateReportDqRuleInput = z.input<typeof updateReportDqRuleSchema>;

export type RunReportDqRuleInput = z.input<typeof runReportDqRuleSchema>;

export type UpdateReportDqAnomalyStatusInput = z.input<typeof updateReportDqAnomalyStatusSchema>;

export const requestReportMaterializationSchema = z.object({
  strategy: reportMaterializationStrategySchema.default('full'),
  keyField: reportIdentifierSchema('增量键').nullable().optional(),
  deltaWindowMinutes: z.number().int().positive().max(525_600).nullable().optional(),
  expiresAt: dateTimeStringSchema.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.strategy === 'incremental' && !value.keyField) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keyField'], message: '增量物化必须指定增量键' });
  }
});

export const expireReportMaterializationSchema = z.object({ reason: z.string().max(500).optional() });

export type RequestReportMaterializationInput = z.input<typeof requestReportMaterializationSchema>;

const reportQueryQuotaSchemaBase = z.object({
  scope: reportQuotaScopeSchema,
  userId: z.number().int().positive().nullable().optional(),
  maxConcurrent: z.number().int().nonnegative().max(10_000),
  dailyQueryLimit: z.number().int().nonnegative(),
  dailyRowLimit: z.number().int().nonnegative(),
  dailyByteLimit: z.number().int().nonnegative(),
  dailyCostLimit: z.number().nonnegative(),
  resetTimezone: timezoneSchema.default('Asia/Shanghai'),
  enabled: z.boolean().default(true),
});

function refineReportQueryQuota(
  value: { scope?: z.infer<typeof reportQuotaScopeSchema>; userId?: number | null },
  ctx: z.RefinementCtx,
) {
  if (value.scope === 'user' && !value.userId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userId'], message: '用户配额必须指定用户' });
  }
  if (value.scope === 'tenant' && value.userId != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userId'], message: '租户配额不能指定用户' });
  }
}

export const createReportQueryQuotaSchema = reportQueryQuotaSchemaBase.superRefine(refineReportQueryQuota);

export const updateReportQueryQuotaSchema = partialForUpdate(reportQueryQuotaSchemaBase).superRefine(refineReportQueryQuota);

export const resetReportQueryQuotaSchema = z.object({ scopeDate: z.string().date().optional() });

export type CreateReportQueryQuotaInput = z.input<typeof createReportQueryQuotaSchema>;

export type UpdateReportQueryQuotaInput = z.input<typeof updateReportQueryQuotaSchema>;

const reportSlaRuleSchemaBase = z.object({
  datasetId: z.number().int().positive(),
  name: z.string().trim().min(1).max(128),
  type: reportSlaTypeSchema,
  targetValue: z.number().nonnegative(),
  warningValue: z.number().nonnegative().nullable().optional(),
  windowMinutes: z.number().int().positive().max(525_600),
  cron: z.string().max(64).nullable().optional(),
  timezone: timezoneSchema.default('Asia/Shanghai'),
  severity: reportDqSeveritySchema.default('high'),
  channels: z.array(reportNotifyChannelSchema).max(3).default([]),
  recipients: z.string().max(512).nullable().optional(),
  webhookUrl: httpUrl('Webhook 地址必须是合法的 http(s) URL').max(512).nullable().optional(),
  silenceMins: z.number().int().min(0).max(10_080).default(60),
  enabled: z.boolean().default(true),
});

export const createReportSlaRuleSchema = reportSlaRuleSchemaBase.superRefine((value, ctx) => {
  if (value.channels.includes('email') && !value.recipients?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipients'], message: '邮件通知必须填写收件人' });
  }
  if (value.channels.includes('webhook') && !value.webhookUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['webhookUrl'], message: 'Webhook 通知必须填写地址' });
  }
});

export const updateReportSlaRuleSchema = partialForUpdate(reportSlaRuleSchemaBase).extend({
  webhookUrl: z.union([httpUrl('Webhook 地址必须是合法的 http(s) URL').max(512), z.literal('******')]).nullable().optional(),
});

export const updateReportSlaViolationSchema = z.object({
  status: z.enum(['acknowledged', 'resolved']),
  note: z.string().max(1000).optional(),
});

export type CreateReportSlaRuleInput = z.input<typeof createReportSlaRuleSchema>;

export type UpdateReportSlaRuleInput = z.input<typeof updateReportSlaRuleSchema>;

export type UpdateReportSlaViolationInput = z.input<typeof updateReportSlaViolationSchema>;

const reportDeprecationNoticeSchemaBase = reportResourceRefSchema.extend({
  title: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(2000),
  replacementResourceType: reportResourceTypeSchema.nullable().optional(),
  replacementResourceId: z.number().int().positive().nullable().optional(),
  effectiveAt: dateTimeStringSchema,
  expiresAt: dateTimeStringSchema.nullable().optional(),
});

function refineReportDeprecationNotice(
  value: { replacementResourceType?: z.infer<typeof reportResourceTypeSchema> | null; replacementResourceId?: number | null },
  ctx: z.RefinementCtx,
) {
  const hasType = value.replacementResourceType != null;
  const hasId = value.replacementResourceId != null;
  if (hasType !== hasId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['replacementResourceId'], message: '替代资源类型和 ID 必须同时提供' });
  }
}

export const createReportDeprecationNoticeSchema = reportDeprecationNoticeSchemaBase.superRefine(refineReportDeprecationNotice);

export const updateReportDeprecationNoticeSchema = partialForUpdate(
  reportDeprecationNoticeSchemaBase.omit({ resourceType: true, resourceId: true }),
).superRefine(refineReportDeprecationNotice);

export const publishReportDeprecationNoticeSchema = z.object({ publish: z.boolean().default(true) });

export type CreateReportDeprecationNoticeInput = z.input<typeof createReportDeprecationNoticeSchema>;

export type UpdateReportDeprecationNoticeInput = z.input<typeof updateReportDeprecationNoticeSchema>;

export const createReportAssetTemplateSchema = z.object({
  folderId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  code: reportIdentifierSchema('模板编码', 64),
  name: z.string().trim().min(1).max(128),
  type: reportAssetTemplateTypeSchema,
  description: z.string().max(1000).nullable().optional(),
  content: z.record(z.string(), z.unknown()),
  previewFileId: z.uuid().nullable().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
});

export const updateReportAssetTemplateSchema = partialForUpdate(createReportAssetTemplateSchema).omit({ code: true });

export const cloneReportAssetTemplateSchema = z.object({
  name: z.string().trim().min(1).max(128),
  folderId: z.number().int().positive().nullable().optional(),
});

export const applyReportAssetTemplateSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  folderId: z.number().int().positive().nullable().optional(),
  targetResourceId: z.number().int().positive().optional(),
});

export type CreateReportAssetTemplateInput = z.input<typeof createReportAssetTemplateSchema>;

export type UpdateReportAssetTemplateInput = z.input<typeof updateReportAssetTemplateSchema>;

export type ApplyReportAssetTemplateInput = z.input<typeof applyReportAssetTemplateSchema>;

export const createReportChatbiSessionSchema = z.object({
  title: z.string().trim().min(1).max(128),
  datasourceId: z.number().int().positive().nullable().optional(),
  datasetId: z.number().int().positive().nullable().optional(),
  allowedTables: z.array(reportIdentifierSchema('允许访问的表')).max(100).default([]),
}).refine((value) => value.datasourceId != null || value.datasetId != null, {
  path: ['datasetId'],
  message: '必须选择数据源或数据集上下文',
});

export const updateReportChatbiSessionSchema = z.object({
  title: z.string().trim().min(1).max(128).optional(),
  status: reportChatbiSessionStatusSchema.optional(),
});

export const createReportChatbiMessageSchema = z.object({
  content: z.string().trim().min(1, '请输入问题').max(4000),
  requestChart: z.boolean().default(true),
  maxRows: z.number().int().positive().max(1000).default(100),
  configSource: z.enum(['system', 'user']).optional(),
  configId: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.configSource === 'user' && !value.configId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configId'], message: '使用个人 AI 配置时必须选择配置' });
  }
});

export const saveReportChatbiMessageAssetSchema = z.object({
  resourceType: z.enum(['dataset', 'dashboard']),
  name: z.string().trim().min(1).max(128).optional(),
  folderId: z.number().int().positive().nullable().optional(),
  targetDashboardId: z.number().int().positive().optional(),
  expectedDashboardRevision: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (!value.targetDashboardId && !value.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: '新建资源时必须填写名称' });
  }
  if (value.targetDashboardId && value.resourceType !== 'dashboard') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetDashboardId'], message: '仅仪表盘保存支持目标仪表盘' });
  }
  if (value.targetDashboardId && !value.expectedDashboardRevision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedDashboardRevision'], message: '添加到现有仪表盘必须提供期望修订号' });
  }
});

export type CreateReportChatbiSessionInput = z.input<typeof createReportChatbiSessionSchema>;

export type UpdateReportChatbiSessionInput = z.input<typeof updateReportChatbiSessionSchema>;

export type CreateReportChatbiMessageInput = z.input<typeof createReportChatbiMessageSchema>;

export type SaveReportChatbiMessageAssetInput = z.input<typeof saveReportChatbiMessageAssetSchema>;

const reportFillTemplateSchemaBase = z.object({
  folderId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  code: reportIdentifierSchema('填报模板编码', 64),
  name: z.string().trim().min(1).max(128),
  description: z.string().max(1000).nullable().optional(),
  formSchema: workflowFormSchemaSchema,
  workflowDefinitionId: z.number().int().positive().nullable().optional(),
  needReview: z.boolean().default(false),
});

function refineReportFillTemplate(
  _value: { needReview?: boolean; workflowDefinitionId?: number | null },
  _ctx: z.RefinementCtx,
) {
  // 工作流可选：需要审核但未绑定工作流时走模块内人工审核。
}

export const createReportFillTemplateSchema = reportFillTemplateSchemaBase.superRefine(refineReportFillTemplate);

export const updateReportFillTemplateSchema = partialForUpdate(reportFillTemplateSchemaBase.omit({ code: true }))
  .extend({ expectedRevision: z.number().int().positive() })
  .superRefine(refineReportFillTemplate);

export const reportFillTemplateLifecycleActionSchema = z.object({
  action: z.enum(['publish', 'offline']),
  expectedRevision: z.number().int().positive(),
  note: z.string().max(500).optional(),
});

export const cloneReportFillTemplateSchema = z.object({
  code: reportIdentifierSchema('填报模板编码', 64),
  name: z.string().trim().min(1).max(128),
  folderId: z.number().int().positive().nullable().optional(),
});

export type CreateReportFillTemplateInput = z.input<typeof createReportFillTemplateSchema>;

export type UpdateReportFillTemplateInput = z.input<typeof updateReportFillTemplateSchema>;

export type ReportFillTemplateLifecycleActionInput = z.input<typeof reportFillTemplateLifecycleActionSchema>;

export type CloneReportFillTemplateInput = z.input<typeof cloneReportFillTemplateSchema>;

export const createReportFillRecordSchema = z.object({
  templateId: z.number().int().positive(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const updateReportFillRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().int().positive(),
});

export const submitReportFillRecordSchema = z.object({
  expectedRevision: z.number().int().positive(),
  comment: z.string().max(1000).optional(),
});

export const reviewReportFillRecordSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  expectedRevision: z.number().int().positive(),
  comment: z.string().max(1000).optional(),
});

export const cancelReportFillRecordSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export type CreateReportFillRecordInput = z.input<typeof createReportFillRecordSchema>;

export type UpdateReportFillRecordInput = z.input<typeof updateReportFillRecordSchema>;

export type SubmitReportFillRecordInput = z.input<typeof submitReportFillRecordSchema>;

export type ReviewReportFillRecordInput = z.input<typeof reviewReportFillRecordSchema>;

export type CancelReportFillRecordInput = z.input<typeof cancelReportFillRecordSchema>;

export const updateReportMobileDashboardPreferenceSchema = z.object({
  compactMode: z.boolean().optional(),
  hiddenWidgetIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  widgetOrder: z.array(z.string().min(1).max(64)).max(200).optional(),
  defaultFilterValues: z.record(z.string(), z.unknown()).optional(),
  refreshInterval: z.number().int().min(0).max(86_400).optional(),
});

export type UpdateReportMobileDashboardPreferenceInput = z.input<typeof updateReportMobileDashboardPreferenceSchema>;

export const saveCmsWidgetSlotSchema = z.strictObject({
  siteId: z.number().int().positive(),
  widgetId: z.number().int().positive().nullable(),
  rendererKey: z.enum(CMS_WIDGET_RENDERER_KEYS).default('list-sidebar'),
  styleProps: z.record(z.string(), z.unknown()).default({}),
});

export type SaveCmsWidgetSlotInput = z.input<typeof saveCmsWidgetSlotSchema>;
