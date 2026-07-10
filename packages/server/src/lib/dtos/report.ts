import { z } from '@hono/zod-openapi';
import {
  REPORT_DASHBOARD_LIFECYCLE_STATUSES,
  REPORT_DASHBOARD_VERSION_SOURCES,
  REPORT_DATASOURCE_TYPES,
  REPORT_WIDGET_TYPES,
} from '@zenith/shared';
import { auditFields } from './_audit';

const ReportFieldDTO = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean']),
  format: z.object({
    kind: z.enum(['number', 'percent', 'currency', 'date', 'datetime', 'dict']),
    decimals: z.number().int().optional(),
    thousands: z.boolean().optional(),
    currencySymbol: z.string().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    dictCode: z.string().optional(),
  }).optional(),
});

const ReportResultFieldDTO = ReportFieldDTO.extend({
  source: z.enum(['declared', 'computed', 'inferred']).optional(),
});

const ReportGridItemDTO = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
});

const ReportCanvasItemDTO = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  z: z.number().optional(),
});

const ReportComputedFieldDTO = z.object({
  name: z.string(),
  label: z.string(),
  expression: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean']).optional(),
});

const ReportDatasetParamDTO = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean']),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const ReportWidgetDTO = z.object({
  i: z.string(),
  type: z.enum(REPORT_WIDGET_TYPES),
  title: z.string(),
  datasetId: z.number().int().nullable().optional(),
  options: z.record(z.string(), z.unknown()),
  paramBindings: z.array(z.object({ filterId: z.string(), param: z.string() })).optional(),
  interaction: z.record(z.string(), z.unknown()).optional(),
  drilldown: z.record(z.string(), z.unknown()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  page: z.number().int().optional(),
});

const ReportFilterDTO = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['date', 'daterange', 'select', 'multiSelect', 'input', 'numberRange']),
  defaultValue: z.unknown().optional(),
  optionSource: z.record(z.string(), z.unknown()).optional(),
  width: z.number().optional(),
});

export const ReportDatasourceDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(REPORT_DATASOURCE_TYPES),
    config: z.record(z.string(), z.unknown()),
    status: z.enum(['enabled', 'disabled']),
    lastTestAt: z.string().nullable().optional(),
    lastTestStatus: z.enum(['success', 'failed', 'unknown']).nullable().optional(),
    lastTestLatencyMs: z.number().int().nullable().optional(),
    lastTestError: z.string().nullable().optional(),
    consecutiveFailures: z.number().int().optional(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDatasource');

export const ReportDatasetDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    datasourceId: z.number().int(),
    datasourceName: z.string().nullable().optional(),
    type: z.enum(REPORT_DATASOURCE_TYPES),
    content: z.record(z.string(), z.unknown()),
    fields: z.array(ReportFieldDTO),
    params: z.array(ReportDatasetParamDTO),
    computedFields: z.array(ReportComputedFieldDTO),
    cacheTtl: z.number().int(),
    materialize: z.object({
      enabled: z.boolean(),
      cron: z.string().optional(),
      refreshedAt: z.string().nullable().optional(),
      refreshedAtMs: z.number().nullable().optional(),
    }).optional(),
    rowRules: z.array(z.object({
      roles: z.array(z.string()).optional(),
      where: z.string(),
      enabled: z.boolean().optional(),
      remark: z.string().optional(),
    })).optional(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDataset');

/** 数据集下游引用（血缘） */
export const ReportDatasetRefsDTO = z
  .object({
    dashboards: z.array(z.object({
      id: z.number().int(),
      name: z.string(),
      widgets: z.array(z.string()),
      filterIds: z.array(z.string()),
    })),
    printTemplates: z.array(z.object({ id: z.number().int(), name: z.string() })),
    alerts: z.array(z.object({ id: z.number().int(), name: z.string() })),
    subscriptions: z.array(z.object({ id: z.number().int(), dashboardId: z.number().int(), name: z.string() })).optional(),
    shares: z.array(z.object({ id: z.number().int(), dashboardId: z.number().int(), name: z.string() })).optional(),
    embedTokens: z.array(z.object({ id: z.number().int(), dashboardId: z.number().int(), name: z.string() })).optional(),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.enum(['datasource', 'dataset', 'dashboard', 'widget', 'filter', 'print', 'alert', 'subscription', 'share', 'embed']),
      refId: z.number().int().nullable().optional(),
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
  })
  .openapi('ReportDatasetRefs');

/** 可视化建模元数据：列 */
export const ReportMetaColumnDTO = z
  .object({ name: z.string(), type: z.string() })
  .openapi('ReportMetaColumn');

export const ReportDashboardDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    layout: z.array(ReportGridItemDTO),
    canvasLayout: z.array(ReportCanvasItemDTO),
    widgets: z.array(ReportWidgetDTO),
    filters: z.array(ReportFilterDTO),
    config: z.record(z.string(), z.unknown()),
    categoryId: z.number().int().nullable().optional(),
    categoryName: z.string().nullable().optional(),
    favorited: z.boolean().optional(),
    status: z.enum(['enabled', 'disabled']),
    lifecycleStatus: z.enum(REPORT_DASHBOARD_LIFECYCLE_STATUSES),
    revision: z.number().int().positive(),
    publishedSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    publishedBy: z.number().int().nullable().optional(),
    publishedByName: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboard');

/** 数据集取数结果 */
export const ReportDataResultDTO = z
  .object({
    columns: z.array(z.string()),
    fields: z.array(ReportResultFieldDTO),
    rows: z.array(z.record(z.string(), z.unknown())),
    total: z.number().nullable().optional(),
    bytes: z.number().int().nullable().optional(),
    truncated: z.boolean().optional(),
    truncatedReason: z.string().nullable().optional(),
  })
  .openapi('ReportDataResult');

export const ReportWidgetDataErrorDTO = z.object({
  code: z.number().int(),
  message: z.string(),
}).openapi('ReportWidgetDataError');

export const ReportDashboardWidgetDataDTO = z.object({
  data: ReportDataResultDTO.nullable(),
  error: ReportWidgetDataErrorDTO.nullable(),
  durationMs: z.number().int().nonnegative(),
  cacheHit: z.boolean(),
}).openapi('ReportDashboardWidgetData');

/** 仪表盘批量取数结果：{ [widgetId]: { data, error, durationMs, cacheHit } } */
export const ReportDashboardDataDTO = z.record(z.string(), ReportDashboardWidgetDataDTO).openapi('ReportDashboardData');

export const ReportDatasetExecutionLogDTO = z.object({
  id: z.number().int(),
  datasetId: z.number().int().nullable(),
  datasetName: z.string().nullable().optional(),
  datasourceId: z.number().int().nullable(),
  datasourceName: z.string().nullable().optional(),
  userId: z.number().int().nullable(),
  username: z.string().nullable().optional(),
  tenantId: z.number().int().nullable(),
  scene: z.string(),
  sourceRefId: z.string().nullable().optional(),
  durationMs: z.number().int(),
  rowCount: z.number().int().nullable().optional(),
  bytes: z.number().int().nullable().optional(),
  truncated: z.boolean().optional(),
  slow: z.boolean().optional(),
  cacheHit: z.boolean(),
  success: z.boolean(),
  errorCode: z.number().int().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  paramKeys: z.array(z.string()).optional(),
  executedAt: z.string(),
}).openapi('ReportDatasetExecutionLog');

export const ReportDashboardCategoryDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    sort: z.number().int(),
    dashboardCount: z.number().int().optional(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardCategory');

export const ReportLookupOptionDTO = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.enum(['enabled', 'disabled']).nullable().optional(),
  type: z.enum(REPORT_DATASOURCE_TYPES).nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  datasourceId: z.number().int().nullable().optional(),
  datasourceName: z.string().nullable().optional(),
  dashboardCount: z.number().int().optional(),
}).openapi('ReportLookupOption');

export const ReportRuntimeGovernanceDTO = z.object({
  slowQueryMs: z.number().int(),
  dashboardMaxConcurrent: z.number().int(),
  datasetMaxRows: z.number().int(),
  datasetMaxBytes: z.number().int(),
}).openapi('ReportRuntimeGovernance');

export const ReportExecutionStatsSlowItemDTO = z.object({
  datasetId: z.number().int().nullable(),
  datasetName: z.string().nullable().optional(),
  datasourceId: z.number().int().nullable(),
  datasourceName: z.string().nullable().optional(),
  scene: z.string(),
  count: z.number().int(),
  avgDurationMs: z.number().int(),
  maxDurationMs: z.number().int(),
  lastExecutedAt: z.string().nullable(),
}).openapi('ReportExecutionStatsSlowItem');

export const ReportExecutionStatsDTO = z.object({
  total: z.number().int(),
  successCount: z.number().int(),
  successRate: z.number(),
  p95DurationMs: z.number().int(),
  avgDurationMs: z.number().int(),
  cacheHitRate: z.number(),
  slowCount: z.number().int(),
  truncatedCount: z.number().int(),
  governance: ReportRuntimeGovernanceDTO,
  topSlowQueries: z.array(ReportExecutionStatsSlowItemDTO),
}).openapi('ReportExecutionStats');

export const ReportDashboardVersionDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    version: z.number().int(),
    snapshot: z.record(z.string(), z.unknown()),
    source: z.enum(REPORT_DASHBOARD_VERSION_SOURCES),
    remark: z.string().nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('ReportDashboardVersion');

export const ReportDashboardVersionDiffDTO = z
  .object({
    leftLabel: z.string(),
    rightLabel: z.string(),
    summary: z.array(z.string()),
    widgets: z.object({
      added: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), changedFields: z.array(z.string()).optional() })),
      removed: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), changedFields: z.array(z.string()).optional() })),
      modified: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), changedFields: z.array(z.string()).optional() })),
    }),
    layoutChanged: z.boolean(),
    filtersChanged: z.boolean(),
    configChanged: z.boolean(),
    metadataChanged: z.boolean(),
  })
  .openapi('ReportDashboardVersionDiff');

export const ReportDashboardShareDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    token: z.string(),
    enabled: z.boolean(),
    hasPassword: z.boolean().optional(),
    expireAt: z.string().nullable().optional(),
    maxAccessCount: z.number().int().nullable().optional(),
    allowedCidrs: z.array(z.string()).optional(),
    allowedIps: z.array(z.string()).optional(),
    accessCount: z.number().int().optional(),
    lastAccessAt: z.string().nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardShare');

export const ReportDashboardEmbedTokenDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    token: z.string(),
    allowedFilterIds: z.array(z.string()),
    fixedFilters: z.record(z.string(), z.unknown()),
    expireAt: z.string().nullable().optional(),
    revokedAt: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardEmbedToken');

const ReportNotifyChannelDTO = z.enum(['email', 'inApp', 'webhook']);
const ReportScheduleMisfirePolicyDTO = z.enum(['skip', 'fire_once']);
const ReportDeliveryStatusDTO = z.enum(['pending', 'running', 'success', 'partial', 'failed', 'cancelled']);
const ReportDeliveryTriggerTypeDTO = z.enum(['manual', 'scheduled', 'trigger', 'recover']);

export const ReportDashboardSubscriptionDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    dashboardName: z.string().nullable().optional(),
    cron: z.string(),
    timezone: z.string(),
    misfirePolicy: ReportScheduleMisfirePolicyDTO,
    channels: z.array(ReportNotifyChannelDTO),
    recipients: z.string().nullable().optional(),
    webhookUrl: z.string().nullable().optional(),
    enabled: z.boolean(),
    remark: z.string().nullable().optional(),
    lastRunAt: z.string().nullable().optional(),
    nextRunAt: z.string().nullable().optional(),
    lastDeliveryAt: z.string().nullable().optional(),
    lastDeliveryStatus: ReportDeliveryStatusDTO.nullable().optional(),
    lastDeliveryError: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardSubscription');

export const ReportDeliveryAttemptDTO = z
  .object({
    id: z.number().int(),
    runId: z.number().int(),
    channel: ReportNotifyChannelDTO,
    attempt: z.number().int(),
    status: ReportDeliveryStatusDTO,
    durationMs: z.number().int().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    payloadSummary: z.record(z.string(), z.unknown()).nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDeliveryAttempt');

export const ReportDeliveryRunDTO = z
  .object({
    id: z.number().int(),
    targetType: z.enum(['subscription', 'alert']),
    subscriptionId: z.number().int().nullable().optional(),
    alertRuleId: z.number().int().nullable().optional(),
    dashboardId: z.number().int().nullable().optional(),
    datasetId: z.number().int().nullable().optional(),
    targetName: z.string().nullable().optional(),
    triggerType: ReportDeliveryTriggerTypeDTO,
    status: ReportDeliveryStatusDTO,
    idempotencyKey: z.string(),
    attempt: z.number().int(),
    maxAttempts: z.number().int(),
    durationMs: z.number().int().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    payloadSummary: z.record(z.string(), z.unknown()).nullable().optional(),
    lastValue: z.number().nullable().optional(),
    triggered: z.boolean().nullable().optional(),
    acknowledgedAt: z.string().nullable().optional(),
    acknowledgedBy: z.number().int().nullable().optional(),
    acknowledgedByName: z.string().nullable().optional(),
    acknowledgeNote: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    nextRetryAt: z.string().nullable().optional(),
    attempts: z.array(ReportDeliveryAttemptDTO).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDeliveryRun');

export const ReportPublicDashboardDTO = z
  .object({
    name: z.string(),
    layout: z.array(ReportGridItemDTO),
    canvasLayout: z.array(ReportCanvasItemDTO),
    widgets: z.array(ReportWidgetDTO),
    filters: z.array(ReportFilterDTO),
    config: z.record(z.string(), z.unknown()),
    filterOptions: z.record(z.string(), z.array(z.object({ value: z.string(), label: z.string() }))).optional(),
  })
  .openapi('ReportPublicDashboard');

export const ReportPublicAccessSessionDTO = z
  .object({
    accessSessionToken: z.string(),
    expiresAt: z.string(),
    dashboard: ReportPublicDashboardDTO,
  })
  .openapi('ReportPublicAccessSession');

/** 数据源连接测试结果 */
export const ReportDatasourceTestResultDTO = z
  .object({ ok: z.boolean(), message: z.string(), latencyMs: z.number().optional() })
  .openapi('ReportDatasourceTestResult');

// ─── 类 Excel 打印报表 ────────────────────────────────────────────────────────
const ReportPrintGridDTO = z.object({
  rows: z.number().int(),
  cols: z.number().int(),
  colWidths: z.array(z.number()).optional(),
  rowHeights: z.array(z.number()).optional(),
  cells: z.array(z.object({
    row: z.number().int(),
    col: z.number().int(),
    v: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    kind: z.enum(['text', 'formula', 'image', 'qrcode', 'barcode']).optional(),
    formula: z.string().optional(),
    numFmt: z.string().optional(),
    image: z.object({
      src: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      fit: z.enum(['contain', 'cover']).optional(),
      alt: z.string().optional(),
    }).optional(),
    s: z.record(z.string(), z.unknown()).optional(),
  })),
  merges: z.array(z.object({ row: z.number().int(), col: z.number().int(), rowSpan: z.number().int(), colSpan: z.number().int() })).optional(),
}).openapi('ReportPrintGrid');

const ReportPrintRowRangeDTO = z.object({
  start: z.number().int(),
  end: z.number().int(),
}).openapi('ReportPrintRowRange');

const ReportPrintPageConfigDTO = z.object({
  paper: z.enum(['A4', 'A3', 'A5', 'Letter']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margin: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
  header: z.string().optional(),
  footer: z.string().optional(),
  backgroundImage: z.string().optional(),
  pageBreaks: z.array(z.number().int()).optional(),
  repeatHeaderRows: ReportPrintRowRangeDTO.nullable().optional(),
  rowsPerPage: z.number().int().optional(),
  calculateRowsPerPage: z.boolean().optional(),
  detailDirection: z.enum(['vertical', 'horizontal']).optional(),
  groupByFields: z.array(z.string()).optional(),
  groupHeaderRows: ReportPrintRowRangeDTO.nullable().optional(),
  groupFooterRows: ReportPrintRowRangeDTO.nullable().optional(),
  pageSubtotalRows: ReportPrintRowRangeDTO.nullable().optional(),
  totalRows: ReportPrintRowRangeDTO.nullable().optional(),
}).openapi('ReportPrintPageConfig');

const ReportPrintSheetDTO: z.ZodTypeAny = z.object({
  id: z.string(),
  name: z.string(),
  grid: ReportPrintGridDTO,
  pageConfig: ReportPrintPageConfigDTO.optional(),
}).openapi('ReportPrintSheet');

const ReportPrintRenderPageDTO: z.ZodTypeAny = z.object({
  sheetId: z.string(),
  sheetName: z.string(),
  pageNumber: z.number().int(),
  totalPages: z.number().int(),
  grid: ReportPrintGridDTO,
  pageConfig: ReportPrintPageConfigDTO,
  headerText: z.string().optional(),
  footerText: z.string().optional(),
}).openapi('ReportPrintRenderPage');

const ReportPrintSheetRenderResultDTO: z.ZodTypeAny = z.object({
  id: z.string(),
  name: z.string(),
  grid: ReportPrintGridDTO,
  pageConfig: ReportPrintPageConfigDTO,
  pages: z.array(ReportPrintRenderPageDTO),
  rowCount: z.number().int(),
}).openapi('ReportPrintSheetRenderResult');

export const ReportPrintTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    datasetId: z.number().int().nullable().optional(),
    datasetName: z.string().nullable().optional(),
    content: z.object({ workbook: z.unknown().optional(), grid: ReportPrintGridDTO.optional(), sheets: z.array(ReportPrintSheetDTO).optional() }),
    params: z.array(ReportDatasetParamDTO),
    pageConfig: ReportPrintPageConfigDTO,
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportPrintTemplate');

/** 打印报表渲染结果（取数填充后的网格 + 页面配置）*/
export const ReportPrintRenderResultDTO = z
  .object({
    name: z.string(),
    grid: ReportPrintGridDTO,
    pageConfig: ReportPrintPageConfigDTO,
    pages: z.array(ReportPrintRenderPageDTO),
    sheets: z.array(ReportPrintSheetRenderResultDTO),
  })
  .openapi('ReportPrintRenderResult');

/** AI NL2SQL 结果 */
export const ReportNl2SqlResultDTO = z
  .object({ sql: z.string() })
  .openapi('ReportNl2SqlResult');

// ─── 数据预警 ────────────────────────────────────────────────────────────────
export const ReportAlertRuleDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    datasetId: z.number().int(),
    datasetName: z.string().nullable().optional(),
    field: z.string().nullable().optional(),
    groupByField: z.string().nullable().optional(),
    aggregate: z.enum(['sum', 'avg', 'max', 'min', 'count', 'first']),
    op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
    threshold: z.number(),
    cron: z.string().nullable().optional(),
    timezone: z.string(),
    misfirePolicy: ReportScheduleMisfirePolicyDTO,
    channels: z.array(ReportNotifyChannelDTO),
    recipients: z.string().nullable().optional(),
    webhookUrl: z.string().nullable().optional(),
    silenceMins: z.number().int(),
    notifyOnRecover: z.boolean(),
    enabled: z.boolean(),
    lastCheckedAt: z.string().nullable().optional(),
    lastTriggered: z.boolean().nullable().optional(),
    lastValue: z.number().nullable().optional(),
    lastNotifiedAt: z.string().nullable().optional(),
    nextRunAt: z.string().nullable().optional(),
    lastDeliveryAt: z.string().nullable().optional(),
    lastDeliveryStatus: ReportDeliveryStatusDTO.nullable().optional(),
    lastDeliveryError: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportAlertRule');

/** 预警评估结果 */
export const ReportAlertEvalResultDTO = z
  .object({
    value: z.number(),
    triggered: z.boolean(),
    status: ReportDeliveryStatusDTO.nullable().optional(),
    deliveryRunId: z.number().int().nullable().optional(),
    hits: z.array(z.object({ group: z.string(), value: z.number() })).optional(),
  })
  .openapi('ReportAlertEvalResult');

// ─── 仪表盘评论 ──────────────────────────────────────────────────────────────
const ReportDashboardCommentBaseDTO = z.object({
  id: z.number().int(),
  dashboardId: z.number().int(),
  widgetId: z.string().nullable().optional(),
  parentId: z.number().int().nullable().optional(),
  content: z.string(),
  userId: z.number().int().nullable().optional(),
  userName: z.string().nullable().optional(),
  userAvatar: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: z.number().int().nullable().optional(),
  resolvedByName: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
  canEdit: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canResolve: z.boolean().optional(),
});

export const ReportDashboardCommentDTO: z.ZodTypeAny = ReportDashboardCommentBaseDTO.extend({
  replies: z.lazy((): z.ZodArray<typeof ReportDashboardCommentDTO> => z.array(ReportDashboardCommentDTO)).optional(),
}).openapi('ReportDashboardComment');
