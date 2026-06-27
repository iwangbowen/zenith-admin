import { z } from '@hono/zod-openapi';
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
  type: z.enum(['kpi', 'table', 'pivot', 'text', 'bar', 'line', 'area', 'dualAxis', 'pie', 'scatter', 'radar', 'funnel', 'gauge', 'treemap', 'flipper', 'scrollList', 'map']),
  title: z.string(),
  datasetId: z.number().int().nullable().optional(),
  options: z.record(z.string(), z.unknown()),
  paramBindings: z.array(z.object({ filterId: z.string(), param: z.string() })).optional(),
  interaction: z.record(z.string(), z.unknown()).optional(),
  drilldown: z.record(z.string(), z.unknown()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
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
    type: z.enum(['api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static']),
    config: z.record(z.string(), z.unknown()),
    status: z.enum(['enabled', 'disabled']),
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
    type: z.enum(['api', 'sql', 'mysql', 'postgresql', 'sqlserver', 'static']),
    content: z.record(z.string(), z.unknown()),
    fields: z.array(ReportFieldDTO),
    params: z.array(ReportDatasetParamDTO),
    computedFields: z.array(ReportComputedFieldDTO),
    cacheTtl: z.number().int(),
    materialize: z.object({
      enabled: z.boolean(),
      cron: z.string().optional(),
      refreshedAt: z.string().nullable().optional(),
    }).optional(),
    status: z.enum(['enabled', 'disabled']),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDataset');

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
    rows: z.array(z.record(z.string(), z.unknown())),
    total: z.number().nullable().optional(),
  })
  .openapi('ReportDataResult');

/** 仪表盘批量取数结果：{ [widgetId]: ReportDataResult } */
export const ReportDashboardDataDTO = z.record(z.string(), ReportDataResultDTO).openapi('ReportDashboardData');

export const ReportDashboardCategoryDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    sort: z.number().int(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardCategory');

export const ReportDashboardVersionDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    version: z.number().int(),
    snapshot: z.record(z.string(), z.unknown()),
    remark: z.string().nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('ReportDashboardVersion');

export const ReportDashboardShareDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    token: z.string(),
    enabled: z.boolean(),
    hasPassword: z.boolean().optional(),
    expireAt: z.string().nullable().optional(),
    createdBy: z.number().int().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardShare');

export const ReportDashboardSubscriptionDTO = z
  .object({
    id: z.number().int(),
    dashboardId: z.number().int(),
    dashboardName: z.string().nullable().optional(),
    cron: z.string(),
    channels: z.array(z.enum(['email', 'inApp'])),
    recipients: z.string().nullable().optional(),
    enabled: z.boolean(),
    remark: z.string().nullable().optional(),
    lastRunAt: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ReportDashboardSubscription');

export const ReportPublicDashboardDTO = z
  .object({
    name: z.string(),
    layout: z.array(ReportGridItemDTO),
    canvasLayout: z.array(ReportCanvasItemDTO),
    widgets: z.array(ReportWidgetDTO),
    filters: z.array(ReportFilterDTO),
    config: z.record(z.string(), z.unknown()),
  })
  .openapi('ReportPublicDashboard');

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
    s: z.record(z.string(), z.unknown()).optional(),
  })),
  merges: z.array(z.object({ row: z.number().int(), col: z.number().int(), rowSpan: z.number().int(), colSpan: z.number().int() })).optional(),
}).openapi('ReportPrintGrid');

const ReportPrintPageConfigDTO = z.object({
  paper: z.enum(['A4', 'A3', 'A5', 'Letter']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margin: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
  header: z.string().optional(),
  footer: z.string().optional(),
  backgroundImage: z.string().optional(),
}).openapi('ReportPrintPageConfig');

export const ReportPrintTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    datasetId: z.number().int().nullable().optional(),
    datasetName: z.string().nullable().optional(),
    content: z.object({ workbook: z.unknown().optional(), grid: ReportPrintGridDTO.optional() }),
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
  })
  .openapi('ReportPrintRenderResult');
