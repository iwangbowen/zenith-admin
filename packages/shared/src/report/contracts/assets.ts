import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_ASSET_TEMPLATE_TYPES, REPORT_RESOURCE_TYPES } from '../types';
import {
  applyReportAssetTemplateSchema,
  cloneReportAssetTemplateSchema,
  createReportAssetTemplateSchema,
  createReportDeprecationNoticeSchema,
  publishReportDeprecationNoticeSchema,
  reportAssetTemplateTypeSchema,
  reportResourceTypeSchema,
  updateReportAssetTemplateSchema,
  updateReportDeprecationNoticeSchema,
} from '../validation';
import { reportStatusSchema, strictQueryBool } from './_common';

const resourceTypeSchema = z.enum(REPORT_RESOURCE_TYPES);

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportAssetUsageLogSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  userId: z.int().nullable().optional(),
  action: z.enum(['view', 'query', 'export', 'embed', 'share']),
  scene: z.string().nullable().optional(),
  durationMs: z.int().nullable().optional(),
  rowCount: z.int(),
  byteSize: z.int(),
  success: z.boolean(),
  occurredAt: z.string(),
}).meta({ id: 'ReportAssetUsageLog' });

export type ReportAssetUsageLog = z.infer<typeof reportAssetUsageLogSchema>;

export const reportDeprecationNoticeSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  title: z.string(),
  message: z.string(),
  replacementResourceType: resourceTypeSchema.nullable().optional(),
  replacementResourceId: z.int().nullable().optional(),
  effectiveAt: z.string(),
  expiresAt: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  publishedBy: z.int().nullable().optional(),
  processedAt: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDeprecationNotice' });

export type ReportDeprecationNotice = z.infer<typeof reportDeprecationNoticeSchema>;

export const reportAssetTemplateSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  folderId: z.int().nullable(),
  folderName: z.string().nullable().optional(),
  ownerId: z.int().nullable(),
  ownerName: z.string().nullable().optional(),
  code: z.string(),
  name: z.string(),
  type: z.enum(REPORT_ASSET_TEMPLATE_TYPES),
  description: z.string().nullable().optional(),
  content: z.record(z.string(), z.unknown()),
  previewFileId: z.string().nullable().optional(),
  version: z.int(),
  usageCount: z.int(),
  status: reportStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportAssetTemplate' });

export type ReportAssetTemplate = z.infer<typeof reportAssetTemplateSchema>;

export const reportAssetUsageSummarySchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  views: z.int(),
  queries: z.int(),
  exports: z.int(),
  uniqueUsers: z.int(),
  lastUsedAt: z.string().nullable().optional(),
  deprecated: z.boolean(),
  deprecationNotice: reportDeprecationNoticeSchema.nullable().optional(),
}).meta({ id: 'ReportAssetUsageSummary' });

export type ReportAssetUsageSummary = z.infer<typeof reportAssetUsageSummarySchema>;

export const reportAssetCatalogItemSchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  tenantId: z.int().nullable(),
  name: z.string(),
  ownerId: z.int().nullable(),
  ownerName: z.string().nullable().optional(),
  folderId: z.int().nullable(),
  folderName: z.string().nullable().optional(),
  lifecycleStatus: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  deprecationEffectiveAt: z.string().nullable().optional(),
  updatedAt: z.string(),
}).meta({ id: 'ReportAssetCatalogItem' });

export type ReportAssetCatalogItem = z.infer<typeof reportAssetCatalogItemSchema>;

export const reportAssetUsageTrendPointSchema = z.object({
  bucket: z.string(),
  views: z.int(),
  queries: z.int(),
  exports: z.int(),
  embeds: z.int(),
  shares: z.int(),
  uniqueUsers: z.int(),
}).meta({ id: 'ReportAssetUsageTrendPoint' });

export type ReportAssetUsageTrendPoint = z.infer<typeof reportAssetUsageTrendPointSchema>;

export const reportAssetTemplateApplyResultSchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  name: z.string(),
}).meta({ id: 'ReportAssetTemplateApplyResult' });

export type ReportAssetTemplateApplyResult = z.infer<typeof reportAssetTemplateApplyResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportAssetCatalogQuery = paginationQuery.extend({
  keyword: z.string().max(128).optional(),
  types: z.string().optional().meta({ description: '资源类型，逗号分隔' }),
  ownerId: z.coerce.number().int().positive().optional(),
  folderId: z.coerce.number().int().positive().optional(),
  lifecycle: z.string().max(32).optional(),
  status: z.string().max(32).optional(),
  updatedStart: z.string().optional(),
  updatedEnd: z.string().optional(),
});

export const reportAssetUsageParam = z.object({
  resourceType: reportResourceTypeSchema,
  id: z.coerce.number().int().positive(),
});

const daysQuery = (max: number, defaultDays: number) =>
  z.coerce.number().int().min(1).max(max).default(defaultDays).meta({ description: '统计窗口（天）', example: defaultDays });

export const reportAssetUsageQuery = z.object({ days: daysQuery(90, 30) });

export const reportAssetTopQuery = z.object({
  days: daysQuery(90, 30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reportAssetInactiveQuery = paginationQuery.extend({ days: daysQuery(3650, 90) });

export const reportAssetTrendQuery = z.object({
  days: daysQuery(90, 30),
  bucket: z.enum(['hour', 'day']).default('day'),
  resourceType: reportResourceTypeSchema.optional(),
  resourceId: z.coerce.number().int().positive().optional(),
});

export const reportDeprecationListQuery = paginationQuery.extend({
  resourceType: reportResourceTypeSchema.optional(),
  resourceId: z.coerce.number().int().positive().optional(),
  published: strictQueryBool,
});

export const reportAssetTemplateListQuery = paginationQuery.extend({
  keyword: z.string().max(128).optional(),
  type: reportAssetTemplateTypeSchema.optional(),
  status: reportStatusSchema.optional(),
});

export const reportAssetContract = defineContract('/api/report/assets', {
  catalog: op.get('/catalog', { query: reportAssetCatalogQuery, response: paginated(reportAssetCatalogItemSchema), summary: '资产目录' }),
  usage: op.get('/usage/{resourceType}/{id}', { params: reportAssetUsageParam, query: reportAssetUsageQuery, response: reportAssetUsageSummarySchema, summary: '资产使用影响' }),
  topAssets: op.get('/usage/top', { query: reportAssetTopQuery, response: z.array(reportAssetUsageSummarySchema), summary: '高频资产' }),
  inactiveAssets: op.get('/usage/inactive', { query: reportAssetInactiveQuery, response: paginated(reportAssetCatalogItemSchema), summary: '闲置资产' }),
  usageTrend: op.get('/usage/trend', { query: reportAssetTrendQuery, response: z.array(reportAssetUsageTrendPointSchema), summary: '资产使用趋势' }),
  deprecations: op.get('/deprecations', { query: reportDeprecationListQuery, response: paginated(reportDeprecationNoticeSchema), summary: '弃用公告列表' }),
  createDeprecation: op.post('/deprecations', { body: createReportDeprecationNoticeSchema, response: reportDeprecationNoticeSchema, summary: '创建弃用公告' }),
  updateDeprecation: op.put('/deprecations/{id}', { params: idParam, body: updateReportDeprecationNoticeSchema, response: reportDeprecationNoticeSchema, summary: '更新弃用公告' }),
  publishDeprecation: op.post('/deprecations/{id}/publish', { params: idParam, body: publishReportDeprecationNoticeSchema, response: reportDeprecationNoticeSchema, summary: '发布或撤销弃用公告' }),
  removeDeprecation: op.delete('/deprecations/{id}', { params: idParam, summary: '删除弃用公告' }),
  templates: op.get('/templates', { query: reportAssetTemplateListQuery, response: paginated(reportAssetTemplateSchema), summary: '资产模板列表' }),
  templateDetail: op.get('/templates/{id}', { params: idParam, response: reportAssetTemplateSchema, summary: '资产模板详情' }),
  createTemplate: op.post('/templates', { body: createReportAssetTemplateSchema, response: reportAssetTemplateSchema, summary: '创建资产模板' }),
  updateTemplate: op.put('/templates/{id}', { params: idParam, body: updateReportAssetTemplateSchema, response: reportAssetTemplateSchema, summary: '更新资产模板' }),
  cloneTemplate: op.post('/templates/{id}/clone', { params: idParam, body: cloneReportAssetTemplateSchema, response: reportAssetTemplateSchema, summary: '克隆资产模板' }),
  applyTemplate: op.post('/templates/{id}/apply', { params: idParam, body: applyReportAssetTemplateSchema, response: reportAssetTemplateApplyResultSchema, summary: '应用资产模板' }),
  removeTemplate: op.delete('/templates/{id}', { params: idParam, summary: '删除资产模板' }),
}, { tags: ['报表资产'] });
