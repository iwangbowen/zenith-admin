/**
 * 定时任务相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const CronJobDTO = z
  .object({
    id: z.number().int(),
    name: z.string().openapi({ example: '数据库备份' }),
    cronExpression: z.string().openapi({ example: '0 0 2 * * *' }),
    handler: z.string().openapi({ example: 'backupDatabase' }),
    params: z.string().nullable(),
    status: z.enum(['enabled', 'disabled']),
    description: z.string(),
    retryCount: z.number().int(),
    retryInterval: z.number().int(),
    monitorTimeout: z.number().int().nullable(),
    lastRunAt: z.string().nullable(),
    nextRunAt: z.string().nullable(),
    lastRunStatus: z.enum(['success', 'fail', 'running']).nullable(),
    lastRunMessage: z.string().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('CronJob');

export const CronJobLogDTO = z
  .object({
    id: z.number().int(),
    jobId: z.number().int(),
    jobName: z.string(),
    executionCount: z.number().int(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    status: z.enum(['success', 'fail', 'running']),
    output: z.string().nullable(),
  })
  .openapi('CronJobLog');
