import { z } from '@hono/zod-openapi';

export const SystemSchedulerTaskTypeDTO = z.enum(['recurring', 'queue']);
export const SystemSchedulerRunStatusDTO = z.enum(['running', 'success', 'failed']);
export const SystemSchedulerTriggerTypeDTO = z.enum(['schedule', 'manual', 'queue']);

export const SystemSchedulerTaskDTO = z
  .object({
    name: z.string(),
    title: z.string(),
    module: z.string(),
    description: z.string().nullable(),
    taskType: SystemSchedulerTaskTypeDTO,
    cronExpression: z.string().nullable(),
    registeredAt: z.string(),
    registeredNodeId: z.string(),
    registeredHostname: z.string(),
    registeredPid: z.number().int(),
    allowManualRun: z.boolean(),
    logRetentionDays: z.number().int(),
    logRetentionRuns: z.number().int(),
    timeoutMs: z.number().int().nullable(),
    failureAlertThreshold: z.number().int(),
    alertEnabled: z.boolean(),
    manualSingleton: z.boolean(),
    nextRunAt: z.string().nullable(),
    running: z.boolean(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: SystemSchedulerRunStatusDTO.nullable(),
    lastRunMessage: z.string().nullable(),
    lastDurationMs: z.number().int().nullable(),
    totalRuns: z.number().int(),
    successCount: z.number().int(),
    failedCount: z.number().int(),
    alertCount: z.number().int(),
    lastAlertAt: z.string().nullable(),
    lastAlertMessage: z.string().nullable(),
    queueQueuedCount: z.number().int(),
    queueActiveCount: z.number().int(),
    queueDeferredCount: z.number().int(),
    queueTotalCount: z.number().int(),
    queueFailedCount: z.number().int(),
    queueCompletedCount: z.number().int(),
    queueStateCounts: z.record(z.string(), z.number().int()),
  })
  .openapi('SystemSchedulerTask');

export const SystemSchedulerRunDTO = z
  .object({
    id: z.number().int(),
    taskName: z.string(),
    taskTitle: z.string(),
    taskType: SystemSchedulerTaskTypeDTO,
    module: z.string(),
    triggerType: SystemSchedulerTriggerTypeDTO,
    status: SystemSchedulerRunStatusDTO,
    jobId: z.string().nullable(),
    nodeId: z.string().nullable(),
    nodeHostname: z.string().nullable(),
    nodePid: z.number().int().nullable(),
    triggeredBy: z.number().int().nullable(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    resultMessage: z.string().nullable(),
    errorMessage: z.string().nullable(),
    alertedAt: z.string().nullable(),
    alertMessage: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('SystemSchedulerRun');

export const SystemSchedulerRunResultDTO = z
  .object({
    message: z.string(),
    runId: z.number().int().optional(),
    jobId: z.string().nullable().optional(),
  })
  .openapi('SystemSchedulerRunResult');

export const SystemSchedulerTaskConfigDTO = z
  .object({
    taskName: z.string(),
    logRetentionDays: z.number().int(),
    logRetentionRuns: z.number().int(),
    timeoutMs: z.number().int().nullable(),
    failureAlertThreshold: z.number().int(),
    alertEnabled: z.boolean(),
    manualSingleton: z.boolean(),
    createdAt: z.union([z.string(), z.date()]).optional(),
    updatedAt: z.union([z.string(), z.date()]).optional(),
  })
  .openapi('SystemSchedulerTaskConfig');

export const SystemSchedulerCleanupResultDTO = z
  .object({
    message: z.string(),
    deletedByAge: z.number().int(),
    deletedByCount: z.number().int(),
    totalBefore: z.number().int(),
    totalAfter: z.number().int(),
  })
  .openapi('SystemSchedulerCleanupResult');
