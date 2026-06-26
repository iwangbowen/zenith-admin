import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

const ReportFieldDTO = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean']),
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

const ReportWidgetDTO = z.object({
  i: z.string(),
  type: z.enum(['kpi', 'table', 'bar', 'line', 'pie']),
  title: z.string(),
  datasetId: z.number().int().nullable().optional(),
  options: z.record(z.string(), z.unknown()),
});

export const ReportDatasourceDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(['api', 'sql']),
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
    type: z.enum(['api', 'sql']),
    content: z.record(z.string(), z.unknown()),
    fields: z.array(ReportFieldDTO),
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
    widgets: z.array(ReportWidgetDTO),
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
