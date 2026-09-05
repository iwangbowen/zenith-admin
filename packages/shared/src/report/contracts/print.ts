import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  createReportPrintTemplateSchema,
  reportBatchStatusSchema,
  reportCloneSchema,
  reportDatasetParamSchema,
  reportLookupQuerySchema,
  reportPrintCellSchema,
  reportPrintCellStyleSchema,
  reportPrintContentSchema,
  reportPrintGridSchema,
  reportPrintMergeSchema,
  reportPrintPageConfigSchema,
  reportPrintRenderSchema,
  reportPrintRowRangeSchema,
  reportPrintSheetSchema,
  updateReportPrintTemplateSchema,
} from '../validation';
import { reportLookupOptionSchema, reportStatusSchema } from './_common';

// ─── 归一化网格 / 页面配置（与请求校验同源，渲染引擎共用） ────────────────────────

export type ReportPrintCellStyle = z.infer<typeof reportPrintCellStyleSchema>;
export type ReportPrintBorder = Exclude<NonNullable<ReportPrintCellStyle['border']>, boolean>;
export type ReportPrintBorderSide = NonNullable<ReportPrintBorder['top']>;
export type ReportPrintCell = z.infer<typeof reportPrintCellSchema>;
export type ReportPrintCellImage = NonNullable<ReportPrintCell['image']>;
export type ReportPrintSubreportCell = NonNullable<ReportPrintCell['subreport']>;
export type ReportPrintMerge = z.infer<typeof reportPrintMergeSchema>;
export type ReportPrintGrid = z.infer<typeof reportPrintGridSchema>;
export type ReportPrintRowRange = z.infer<typeof reportPrintRowRangeSchema>;
export type ReportPrintPageConfig = z.infer<typeof reportPrintPageConfigSchema>;
export type ReportPrintCrosstabConfig = NonNullable<ReportPrintPageConfig['crosstab']>;
export type ReportPrintCrosstabValueField = NonNullable<ReportPrintCrosstabConfig['valueFields']>[number];
export type ReportPrintSheet = z.infer<typeof reportPrintSheetSchema>;
export type ReportPrintRepeatBlock = NonNullable<ReportPrintSheet['repeatBlocks']>[number];
export type ReportPrintContent = z.infer<typeof reportPrintContentSchema>;
export type ReportPrintDatasetBinding = NonNullable<ReportPrintContent['datasetBindings']>[number];

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportPrintTemplateSchema = z.object({
  id: z.int(),
  name: z.string(),
  ownerId: z.int().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  folderId: z.int().nullable().optional(),
  folderName: z.string().nullable().optional(),
  datasetId: z.int().nullable().optional(),
  datasetName: z.string().nullable().optional(),
  content: reportPrintContentSchema,
  params: z.array(reportDatasetParamSchema),
  pageConfig: reportPrintPageConfigSchema,
  status: reportStatusSchema,
  remark: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportPrintTemplate' });

export type ReportPrintTemplate = z.infer<typeof reportPrintTemplateSchema>;

export const reportPrintRenderPageSchema = z.object({
  sheetId: z.string(),
  sheetName: z.string(),
  pageNumber: z.int(),
  totalPages: z.int(),
  grid: reportPrintGridSchema,
  pageConfig: reportPrintPageConfigSchema,
  headerText: z.string().optional(),
  footerText: z.string().optional(),
}).meta({ id: 'ReportPrintRenderPage' });

export type ReportPrintRenderPage = z.infer<typeof reportPrintRenderPageSchema>;

export const reportPrintSheetRenderResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  grid: reportPrintGridSchema,
  pageConfig: reportPrintPageConfigSchema,
  pages: z.array(reportPrintRenderPageSchema),
  rowCount: z.int(),
}).meta({ id: 'ReportPrintSheetRenderResult' });

export type ReportPrintSheetRenderResult = z.infer<typeof reportPrintSheetRenderResultSchema>;

/** 填充后的打印报表（渲染 / 导出结果） */
export const reportPrintRenderResultSchema = z.object({
  name: z.string(),
  grid: reportPrintGridSchema.meta({ description: '首个 sheet 的完整网格' }),
  pageConfig: reportPrintPageConfigSchema,
  pages: z.array(reportPrintRenderPageSchema).meta({ description: '平铺后的页面列表' }),
  sheets: z.array(reportPrintSheetRenderResultSchema).meta({ description: '多 sheet 渲染结果' }),
}).meta({ id: 'ReportPrintRenderResult' });

export type ReportPrintRenderResult = z.infer<typeof reportPrintRenderResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportPrintListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  status: reportStatusSchema.optional(),
});

export const reportPrintContract = defineContract('/api/report/print', {
  list: op.get('/', { query: reportPrintListQuery, response: paginated(reportPrintTemplateSchema), summary: '打印报表列表' }),
  lookup: op.get('/lookup', { query: reportLookupQuerySchema, response: z.array(reportLookupOptionSchema), summary: '打印模板轻量下拉' }),
  batchStatus: op.put('/batch-status', { body: reportBatchStatusSchema, summary: '批量启停打印模板' }),
  detail: op.get('/{id}', { params: idParam, response: reportPrintTemplateSchema, summary: '打印报表详情' }),
  create: op.post('/', { body: createReportPrintTemplateSchema, response: reportPrintTemplateSchema, summary: '创建打印报表' }),
  update: op.put('/{id}', { params: idParam, body: updateReportPrintTemplateSchema, response: reportPrintTemplateSchema, summary: '更新打印报表' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除打印报表' }),
  render: op.post('/{id}/render', { params: idParam, body: reportPrintRenderSchema, response: reportPrintRenderResultSchema, summary: '取数渲染打印报表' }),
  clone: op.post('/{id}/clone', { params: idParam, body: reportCloneSchema, response: reportPrintTemplateSchema, summary: '复制打印模板' }),
}, { tags: ['报表打印'] });
