import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import type { WorkflowFormSchema } from '../../workflow/types';
import { workflowFormSchemaSchema } from '../../workflow/validation';
import { REPORT_FILL_RECORD_STATUSES, REPORT_FILL_SYNC_STATUSES, REPORT_FILL_TEMPLATE_STATUSES } from '../types';
import {
  cancelReportFillRecordSchema,
  cloneReportFillTemplateSchema,
  createReportFillRecordSchema,
  createReportFillTemplateSchema,
  reportFillRecordStatusSchema,
  reportFillTemplateLifecycleActionSchema,
  reportFillTemplateStatusSchema,
  reviewReportFillRecordSchema,
  submitReportFillRecordSchema,
  updateReportFillRecordSchema,
  updateReportFillTemplateSchema,
} from '../validation';

/**
 * 表单 schema 复用工作流域的定义；实体类型以 WorkflowFormSchema 为准。
 * 字段定义自引用，OpenAPI 文档中以 object 终结而不展开递归结构。
 */
const fillFormSchema: z.ZodType<WorkflowFormSchema> = workflowFormSchemaSchema.meta({
  id: 'WorkflowFormSchema',
  type: 'object',
  description: '表单 schema：字段定义（fields）+ 表单级设置（settings），结构由工作流域维护',
});

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const reportFillTemplateSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  folderId: z.int().nullable(),
  folderName: z.string().nullable().optional(),
  ownerId: z.int().nullable(),
  ownerName: z.string().nullable().optional(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  formSchema: fillFormSchema,
  publishedSchema: fillFormSchema.nullable().optional(),
  publishedRevision: z.int().nullable().optional(),
  workflowDefinitionId: z.int().nullable().optional(),
  workflowDefinitionName: z.string().nullable().optional(),
  needReview: z.boolean(),
  generatedDatasetId: z.int().nullable().optional(),
  status: z.enum(REPORT_FILL_TEMPLATE_STATUSES),
  revision: z.int(),
  publishedAt: z.string().nullable().optional(),
  publishedBy: z.int().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportFillTemplate' });

export type ReportFillTemplate = z.infer<typeof reportFillTemplateSchema>;

export const reportFillRecordSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  templateId: z.int(),
  templateName: z.string().nullable().optional(),
  submitterId: z.int(),
  submitterName: z.string().nullable().optional(),
  status: z.enum(REPORT_FILL_RECORD_STATUSES),
  data: z.record(z.string(), z.unknown()),
  templateRevision: z.int(),
  templateSchemaSnapshot: fillFormSchema,
  templateNeedReview: z.boolean(),
  workflowDefinitionIdSnapshot: z.int().nullable().optional(),
  submitComment: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  reviewedBy: z.int().nullable().optional(),
  reviewComment: z.string().nullable().optional(),
  workflowInstanceId: z.int().nullable().optional(),
  generatedDatasetId: z.int().nullable().optional(),
  syncStatus: z.enum(REPORT_FILL_SYNC_STATUSES),
  syncTaskId: z.int().nullable().optional(),
  syncError: z.string().nullable().optional(),
  syncedAt: z.string().nullable().optional(),
  revision: z.int(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportFillRecord' });

export type ReportFillRecord = z.infer<typeof reportFillRecordSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportFillTemplateListQuery = paginationQuery.extend({
  keyword: z.string().max(128).optional(),
  status: reportFillTemplateStatusSchema.optional(),
  ownerId: z.coerce.number().int().positive().optional(),
  folderId: z.coerce.number().int().positive().optional(),
});

export const reportFillMyRecordsQuery = paginationQuery.extend({
  keyword: z.string().max(128).optional(),
  status: reportFillRecordStatusSchema.optional(),
  templateId: z.coerce.number().int().positive().optional(),
});

export const reportFillAdminRecordsQuery = paginationQuery.extend({
  status: reportFillRecordStatusSchema.optional(),
  templateId: z.coerce.number().int().positive().optional(),
  submitterId: z.coerce.number().int().positive().optional(),
});

export const reportFillContract = defineContract('/api/report/fill', {
  templates: op.get('/templates', { query: reportFillTemplateListQuery, response: paginated(reportFillTemplateSchema), summary: '填报模板列表' }),
  templateLookup: op.get('/templates/lookup', { response: z.array(reportFillTemplateSchema), summary: '已发布填报模板选项' }),
  createTemplate: op.post('/templates', { body: createReportFillTemplateSchema, response: reportFillTemplateSchema, summary: '创建填报模板' }),
  templateDetail: op.get('/templates/{id}', { params: idParam, response: reportFillTemplateSchema, summary: '填报模板详情' }),
  updateTemplate: op.put('/templates/{id}', { params: idParam, body: updateReportFillTemplateSchema, response: reportFillTemplateSchema, summary: '更新填报模板' }),
  templateLifecycle: op.post('/templates/{id}/lifecycle', { params: idParam, body: reportFillTemplateLifecycleActionSchema, response: reportFillTemplateSchema, summary: '发布或下线填报模板' }),
  cloneTemplate: op.post('/templates/{id}/clone', { params: idParam, body: cloneReportFillTemplateSchema, response: reportFillTemplateSchema, summary: '克隆填报模板' }),
  removeTemplate: op.delete('/templates/{id}', { params: idParam, summary: '删除填报模板' }),
  myRecords: op.get('/records/mine', { query: reportFillMyRecordsQuery, response: paginated(reportFillRecordSchema), summary: '我的填报记录' }),
  adminRecords: op.get('/records/admin', { query: reportFillAdminRecordsQuery, response: paginated(reportFillRecordSchema), summary: '填报记录管理列表' }),
  createRecord: op.post('/records', { body: createReportFillRecordSchema, response: reportFillRecordSchema, summary: '创建填报草稿' }),
  recordDetail: op.get('/records/{id}', { params: idParam, response: reportFillRecordSchema, summary: '填报记录详情' }),
  updateRecord: op.put('/records/{id}', { params: idParam, body: updateReportFillRecordSchema, response: reportFillRecordSchema, summary: '编辑填报草稿' }),
  submitRecord: op.post('/records/{id}/submit', { params: idParam, body: submitReportFillRecordSchema, response: reportFillRecordSchema, summary: '提交填报记录' }),
  cancelRecord: op.post('/records/{id}/cancel', { params: idParam, body: cancelReportFillRecordSchema, response: reportFillRecordSchema, summary: '取消填报记录' }),
  withdrawRecord: op.post('/records/{id}/withdraw', { params: idParam, body: cancelReportFillRecordSchema, response: reportFillRecordSchema, summary: '撤回填报记录' }),
  reviewRecord: op.post('/records/{id}/review', { params: idParam, body: reviewReportFillRecordSchema, response: reportFillRecordSchema, summary: '人工批准或拒绝填报记录' }),
}, { tags: ['报表填报'] });
