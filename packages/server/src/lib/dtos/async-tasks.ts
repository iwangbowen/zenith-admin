import { z } from '@hono/zod-openapi';

export const AsyncTaskStatusDTO = z.enum(['pending', 'running', 'success', 'failed', 'cancelled']);

export const AsyncTaskDTO = z
  .object({
    id: z.number().int(),
    taskType: z.string(),
    title: z.string(),
    module: z.string().nullable(),
    status: AsyncTaskStatusDTO,
    payload: z.record(z.string(), z.unknown()),
    totalCount: z.number().int().nullable(),
    processedCount: z.number().int(),
    failedCount: z.number().int(),
    progressNote: z.string().nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    errorMessage: z.string().nullable(),
    cancelRequested: z.boolean(),
    attempts: z.number().int(),
    createdBy: z.number().int().nullable(),
    createdByName: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AsyncTask');

export const AsyncTaskTypeMetaDTO = z
  .object({
    taskType: z.string(),
    title: z.string(),
    module: z.string(),
    description: z.string().nullable(),
    allowConcurrent: z.boolean(),
  })
  .openapi('AsyncTaskTypeMeta');

export const AsyncTaskCleanupResultDTO = z
  .object({ cleaned: z.number().int() })
  .openapi('AsyncTaskCleanupResult');
