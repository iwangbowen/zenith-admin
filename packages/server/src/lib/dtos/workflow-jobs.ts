import { z } from '@hono/zod-openapi';

const WORKFLOW_JOB_TYPES = [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
] as const;

const WORKFLOW_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead', 'canceled'] as const;

export const WorkflowJobDTO = z
  .object({
    id: z.number().int(),
    jobType: z.enum(WORKFLOW_JOB_TYPES),
    status: z.enum(WORKFLOW_JOB_STATUSES),
    instanceId: z.number().int().nullable(),
    instanceTitle: z.string().nullable(),
    definitionName: z.string().nullable(),
    taskId: z.number().int().nullable(),
    nodeKey: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    traceId: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    priority: z.number().int(),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    runAt: z.string(),
    lockedAt: z.string().nullable(),
    lockedBy: z.string().nullable(),
    lastError: z.string().nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    tenantId: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowJob');

export const WorkflowJobExecutionDTO = z
  .object({
    id: z.number().int(),
    jobId: z.number().int(),
    jobType: z.enum(WORKFLOW_JOB_TYPES),
    attempt: z.number().int(),
    status: z.enum(['running', 'succeeded', 'failed']),
    requestUrl: z.string().nullable(),
    requestMethod: z.string().nullable(),
    requestBody: z.string().nullable(),
    responseStatus: z.number().int().nullable(),
    responseBody: z.string().nullable(),
    errorMessage: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowJobExecution');

export const WorkflowJobDetailDTO = WorkflowJobDTO.extend({
  executions: z.array(WorkflowJobExecutionDTO),
}).openapi('WorkflowJobDetail');

/** 列表查询 query（叠加 PaginationQuery） */
export const WorkflowJobListQuery = z.object({
  jobType: z.enum(WORKFLOW_JOB_TYPES).optional(),
  status: z.enum(WORKFLOW_JOB_STATUSES).optional(),
  instanceId: z.coerce.number().int().positive().optional(),
  keyword: z.string().optional(),
});

/** 重试 / 改参重放 body */
export const WorkflowJobRetryBody = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** 按作业类型聚合的状态计数（作业账本 Tab 徽标用） */
export const WorkflowJobSummaryItemDTO = z
  .object({
    jobType: z.enum(WORKFLOW_JOB_TYPES),
    total: z.number().int(),
    pending: z.number().int(),
    running: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    dead: z.number().int(),
    canceled: z.number().int(),
  })
  .openapi('WorkflowJobSummaryItem');

/** 批量补偿结果 */
export const WorkflowJobBatchResultDTO = z
  .object({
    total: z.number().int(),
    success: z.number().int(),
    skipped: z.number().int(),
  })
  .openapi('WorkflowJobBatchResult');
