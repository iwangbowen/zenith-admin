/**
 * 数据库备份相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const DbBackupItemDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(['pg_dump', 'drizzle_export']),
    fileId: z.string().uuid().nullable().optional(),
    fileSize: z.number().nullable().optional(),
    status: z.enum(['pending', 'running', 'success', 'failed']),
    tables: z.unknown().nullable().optional(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    durationMs: z.number().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    ...auditFields,
    createdByName: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('DbBackupItem');
