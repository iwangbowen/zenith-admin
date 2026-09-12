import * as z from 'zod';
import { dateRangeQuery, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  EXPORT_COLUMN_TYPES,
  EXPORT_JOB_DELETE_REASONS,
  EXPORT_JOB_EXECUTION_MODES,
  EXPORT_JOB_FORMATS,
  EXPORT_JOB_REQUEST_MODES,
  EXPORT_JOB_STATUSES,
  EXPORT_RENDER_MODES,
} from '../constants';
import { createExportJobSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 导出列定义（多级表头时含 children） */
export const exportColumnMetaSchema = z.object({
  key: z.string(),
  header: z.string(),
  width: z.number().optional(),
  type: queryEnum(EXPORT_COLUMN_TYPES),
  sensitive: z.boolean().optional(),
  get children(): z.ZodOptional<z.ZodArray<typeof exportColumnMetaSchema>> {
    return z.array(exportColumnMetaSchema).optional();
  },
}).meta({ id: 'ExportColumnMeta' });

export type ExportColumnMeta = z.infer<typeof exportColumnMetaSchema>;

/** 可导出实体元信息（按当前用户权限过滤后返回） */
export const exportEntityMetaSchema = z.object({
  entity: z.string().meta({ example: 'system.users' }),
  moduleName: z.string(),
  filenamePrefix: z.string(),
  sourcePath: z.string().optional().meta({ description: '来源页面路由（导出中心「来源页面」跳转）' }),
  formats: z.array(z.enum(EXPORT_JOB_FORMATS)),
  renderMode: z.enum(EXPORT_RENDER_MODES),
  columns: z.array(exportColumnMetaSchema),
  sensitive: z.boolean(),
  execution: z.object({
    mode: z.enum(EXPORT_JOB_REQUEST_MODES),
    syncMaxRows: z.int(),
    maxRows: z.int().meta({ description: '导出行数绝对上限（sync/async 通用），超出时提交被拒绝' }),
    forceAsyncWhenSensitive: z.boolean(),
    forceAsyncWhenRaw: z.boolean(),
    syncModeOverridesAsyncPolicies: z.boolean(),
  }),
  permissions: z.object({
    export: z.string(),
    exportRaw: z.string().optional(),
    requireExportRawPermission: z.boolean().optional(),
  }),
}).meta({ id: 'ExportEntityMeta' });

export type ExportEntityMeta = z.infer<typeof exportEntityMetaSchema>;

export const exportJobSchema = z.object({
  id: z.int(),
  entity: z.string(),
  moduleName: z.string(),
  format: z.enum(EXPORT_JOB_FORMATS),
  status: z.enum(EXPORT_JOB_STATUSES),
  executionMode: z.enum(EXPORT_JOB_EXECUTION_MODES),
  query: z.record(z.string(), z.unknown()),
  columns: z.array(z.string()).nullable(),
  rowCount: z.int().nullable(),
  fileId: z.uuid().nullable(),
  filename: z.string().nullable(),
  fileSize: z.int().nullable(),
  raw: z.boolean(),
  masked: z.boolean(),
  sensitive: z.boolean(),
  watermark: z.boolean(),
  errorMessage: z.string().nullable(),
  expiresAt: z.string().nullable(),
  fileDeletedAt: z.string().nullable(),
  deleteReason: z.enum(EXPORT_JOB_DELETE_REASONS).nullable(),
  downloadCount: z.int(),
  lastDownloadedAt: z.string().nullable(),
  tenantId: z.int().nullable(),
  createdBy: z.int().nullable(),
  createdByName: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ExportJob' });

export type ExportJob = z.infer<typeof exportJobSchema>;

export const exportJobCreateResultSchema = z.object({
  mode: z.enum(EXPORT_JOB_EXECUTION_MODES),
  job: exportJobSchema,
}).meta({ id: 'ExportJobCreateResult' });

export type ExportJobCreateResult = z.infer<typeof exportJobCreateResultSchema>;

export const exportJobDownloadSchema = z.object({
  id: z.int(),
  jobId: z.int(),
  downloadedBy: z.int().nullable(),
  downloadedByName: z.string().nullable(),
  tenantId: z.int().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'ExportJobDownload' });

export type ExportJobDownload = z.infer<typeof exportJobDownloadSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const exportJobListQuery = paginationQuery.extend({
  entity: z.string().optional(),
  status: queryEnum(EXPORT_JOB_STATUSES),
  format: queryEnum(EXPORT_JOB_FORMATS),
  keyword: z.string().optional().meta({ description: '匹配模块名 / 文件名 / 实体' }),
  ...dateRangeQuery(),
});

export const exportJobContract = defineContract('/api/export-jobs', {
  entities: op.get('/entities', { response: z.array(exportEntityMetaSchema), summary: '可导出实体列表' }),
  create: op.post('/', { body: createExportJobSchema, response: exportJobCreateResultSchema, summary: '创建导出任务' }),
  list: op.get('/', { query: exportJobListQuery, response: paginated(exportJobSchema), summary: '导出任务列表' }),
  detail: op.get('/{id}', { params: idParam, response: exportJobSchema, summary: '导出任务详情' }),
  download: op.get('/{id}/download', { params: idParam, kind: 'file', summary: '下载导出文件' }),
  downloads: op.get('/{id}/downloads', { params: idParam, response: z.array(exportJobDownloadSchema), summary: '导出任务下载日志' }),
  cancel: op.post('/{id}/cancel', { params: idParam, response: exportJobSchema, summary: '取消导出任务' }),
  retry: op.post('/{id}/retry', { params: idParam, response: exportJobSchema, summary: '重试导出任务' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除导出任务' }),
}, { tags: ['ExportJobs'] });
