import { z } from '@hono/zod-openapi';

const WORKFLOW_JOB_TYPES = [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
] as const;

const EngineExplanationBlockerDTO = z.object({
  kind: z.enum(['task', 'job']),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  detail: z.string(),
  taskId: z.number().int().nullable(),
  jobId: z.number().int().nullable(),
  jobType: z.enum(WORKFLOW_JOB_TYPES).nullable(),
  nodeName: z.string().nullable(),
  waitingMinutes: z.number().int().nullable(),
  nextRetryAt: z.string().nullable(),
}).openapi('WorkflowEngineExplanationBlocker');

const EngineExplanationDTO = z.object({
  state: z.enum(['running', 'blocked', 'completed', 'rejected', 'canceled', 'withdrawn', 'draft']),
  headline: z.string(),
  blockers: z.array(EngineExplanationBlockerDTO),
  lastError: z.string().nullable(),
  nextWakeAt: z.string().nullable(),
  pendingJobCount: z.number().int(),
  failedJobCount: z.number().int(),
}).openapi('WorkflowEngineExplanation');

const TraceExecutionDTO = z.object({
  attempt: z.number().int(),
  status: z.enum(['running', 'succeeded', 'failed']),
  requestUrl: z.string().nullable(),
  requestMethod: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  finishedAt: z.string().nullable(),
}).openapi('WorkflowEngineTraceExecution');

const TraceEntryDTO = z.object({
  key: z.string(),
  kind: z.enum(['task', 'job', 'token']),
  at: z.string(),
  traceId: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  nodeName: z.string().nullable(),
  assigneeName: z.string().nullable(),
  comment: z.string().nullable(),
  jobId: z.number().int().nullable(),
  jobType: z.enum(WORKFLOW_JOB_TYPES).nullable(),
  attempts: z.number().int().nullable(),
  maxAttempts: z.number().int().nullable(),
  runAt: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  lastError: z.string().nullable(),
  executions: z.array(TraceExecutionDTO),
}).openapi('WorkflowEngineTraceEntry');

export const WorkflowInstanceTraceDTO = z.object({
  instanceId: z.number().int(),
  title: z.string(),
  explanation: EngineExplanationDTO,
  trace: z.array(TraceEntryDTO),
  generatedAt: z.string(),
}).openapi('WorkflowInstanceTrace');
