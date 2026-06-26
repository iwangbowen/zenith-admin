import { z } from '@hono/zod-openapi';

const ExportJobFormatDTO = z.enum(['xlsx', 'csv']);
const ExportJobStatusDTO = z.enum(['pending', 'running', 'success', 'failed', 'cancelled', 'expired']);
const ExportJobExecutionModeDTO = z.enum(['sync', 'async']);
const ExportJobRequestModeDTO = z.enum(['sync', 'async', 'auto']);
const ExportJobDeleteReasonDTO = z.enum(['expired', 'manual', 'file_missing']);

export const ExportColumnMetaDTO: z.ZodType = z.lazy(() =>
  z.object({
    key: z.string(),
    header: z.string(),
    width: z.number().int().optional(),
    type: z.enum(['string', 'number', 'datetime', 'date', 'enum', 'money', 'boolean']).optional(),
    sensitive: z.boolean().optional(),
    children: z.array(ExportColumnMetaDTO).optional(),
  }),
).openapi('ExportColumnMeta');

export const ExportEntityMetaDTO = z
  .object({
    entity: z.string(),
    moduleName: z.string(),
    filenamePrefix: z.string(),
    formats: z.array(ExportJobFormatDTO),
    renderMode: z.enum(['table', 'layout', 'custom']),
    columns: z.array(ExportColumnMetaDTO),
    sensitive: z.boolean(),
    execution: z.object({
      mode: ExportJobRequestModeDTO,
      syncMaxRows: z.number().int(),
      forceAsyncWhenSensitive: z.boolean(),
      forceAsyncWhenRaw: z.boolean(),
      syncModeOverridesAsyncPolicies: z.boolean(),
    }),
    permissions: z.object({
      export: z.string(),
      exportRaw: z.string().optional(),
      requireExportRawPermission: z.boolean().optional(),
    }),
  })
  .openapi('ExportEntityMeta');

export const ExportJobDTO = z
  .object({
    id: z.number().int(),
    entity: z.string(),
    moduleName: z.string(),
    format: ExportJobFormatDTO,
    status: ExportJobStatusDTO,
    executionMode: ExportJobExecutionModeDTO,
    query: z.record(z.string(), z.unknown()),
    columns: z.array(z.string()).nullable(),
    rowCount: z.number().int().nullable(),
    fileId: z.string().uuid().nullable(),
    filename: z.string().nullable(),
    fileSize: z.number().int().nullable(),
    raw: z.boolean(),
    masked: z.boolean(),
    sensitive: z.boolean(),
    watermark: z.boolean(),
    errorMessage: z.string().nullable(),
    expiresAt: z.string().nullable(),
    fileDeletedAt: z.string().nullable(),
    deleteReason: ExportJobDeleteReasonDTO.nullable(),
    downloadCount: z.number().int(),
    lastDownloadedAt: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    createdBy: z.number().int().nullable(),
    createdByName: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ExportJob');

export const ExportJobCreateResultDTO = z
  .object({
    mode: ExportJobExecutionModeDTO,
    job: ExportJobDTO,
  })
  .openapi('ExportJobCreateResult');

export const ExportJobDownloadDTO = z
  .object({
    id: z.number().int(),
    jobId: z.number().int(),
    downloadedBy: z.number().int().nullable(),
    downloadedByName: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ExportJobDownload');
