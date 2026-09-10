import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  PROCESS_ROLES,
  SYSTEM_SCHEDULER_ALERT_CHANNELS,
  SYSTEM_SCHEDULER_ALERT_FILTERS,
  SYSTEM_SCHEDULER_RUN_STATUSES,
  SYSTEM_SCHEDULER_TASK_TYPES,
  SYSTEM_SCHEDULER_TRIGGER_TYPES,
} from '../constants';
import { acknowledgeSystemSchedulerAlertSchema, updateSystemSchedulerTaskConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 系统调度任务注册信息基础字段（任务中心与工作流引擎诊断共用） */
export const systemSchedulerTaskBaseSchema = z.object({
  name: z.string().meta({ example: 'export-file-cleanup' }),
  title: z.string(),
  module: z.string(),
  description: z.string().nullable(),
  taskType: z.enum(SYSTEM_SCHEDULER_TASK_TYPES),
  cronExpression: z.string().nullable(),
  registeredAt: z.string(),
  registeredNodeId: z.string(),
  registeredHostname: z.string(),
  registeredPid: z.int(),
  allowManualRun: z.boolean(),
  enabled: z.boolean(),
  logRetentionDays: z.int(),
  logRetentionRuns: z.int(),
  timeoutMs: z.int().nullable(),
  failureAlertThreshold: z.int(),
  alertEnabled: z.boolean(),
  alertChannels: z.array(z.enum(SYSTEM_SCHEDULER_ALERT_CHANNELS)),
  alertUserIds: z.array(z.int()),
  alertEmails: z.array(z.string()),
  alertWebhookUrl: z.string().nullable(),
  manualSingleton: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.enum(SYSTEM_SCHEDULER_RUN_STATUSES).nullable(),
  lastRunMessage: z.string().nullable(),
  lastDurationMs: z.int().nullable(),
});

export type SystemSchedulerTaskBase = z.infer<typeof systemSchedulerTaskBaseSchema>;

export const systemSchedulerTaskSchema = systemSchedulerTaskBaseSchema.extend({
  nextRunAt: z.string().nullable(),
  running: z.boolean(),
  totalRuns: z.int(),
  successCount: z.int(),
  failedCount: z.int(),
  alertCount: z.int(),
  lastAlertAt: z.string().nullable(),
  lastAlertMessage: z.string().nullable(),
  queueQueuedCount: z.int(),
  queueActiveCount: z.int(),
  queueDeferredCount: z.int(),
  queueTotalCount: z.int(),
  queueFailedCount: z.int(),
  queueCompletedCount: z.int(),
  queueStateCounts: z.record(z.string(), z.int()),
}).meta({ id: 'SystemSchedulerTask' });

export type SystemSchedulerTask = z.infer<typeof systemSchedulerTaskSchema>;

export const systemSchedulerRunSchema = z.object({
  id: z.int(),
  taskName: z.string(),
  taskTitle: z.string(),
  taskType: z.enum(SYSTEM_SCHEDULER_TASK_TYPES),
  module: z.string(),
  triggerType: z.enum(SYSTEM_SCHEDULER_TRIGGER_TYPES),
  status: z.enum(SYSTEM_SCHEDULER_RUN_STATUSES),
  jobId: z.string().nullable(),
  nodeId: z.string().nullable(),
  nodeHostname: z.string().nullable(),
  nodePid: z.int().nullable(),
  triggeredBy: z.int().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.int().nullable(),
  resultMessage: z.string().nullable(),
  errorMessage: z.string().nullable(),
  alertedAt: z.string().nullable(),
  alertMessage: z.string().nullable(),
  alertSentAt: z.string().nullable(),
  alertChannels: z.array(z.enum(SYSTEM_SCHEDULER_ALERT_CHANNELS)),
  alertAckAt: z.string().nullable(),
  alertAckBy: z.int().nullable(),
  alertAckByName: z.string().nullable(),
  alertAckNote: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'SystemSchedulerRun' });

export type SystemSchedulerRun = z.infer<typeof systemSchedulerRunSchema>;

export const systemSchedulerNodeSchema = z.object({
  nodeId: z.string(),
  hostname: z.string(),
  pid: z.int(),
  /** 该进程承担的角色；只含 `api` 的节点仅声明任务、不执行 */
  roles: z.array(z.enum(PROCESS_ROLES)),
  version: z.string().nullable(),
  startedAt: z.string(),
  lastHeartbeatAt: z.string(),
  registeredTaskCount: z.int(),
  runningJobCount: z.int(),
  active: z.boolean(),
  stale: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SystemSchedulerNode' });

export type SystemSchedulerNode = z.infer<typeof systemSchedulerNodeSchema>;

export const systemSchedulerRunResultSchema = z.object({
  message: z.string(),
  runId: z.int().nullable().meta({ description: '本次触发对应的运行记录；已有排队作业、本次触发与之合并时为 null' }),
  jobId: z.string().nullable(),
}).meta({ id: 'SystemSchedulerRunResult' });

export type SystemSchedulerRunResult = z.infer<typeof systemSchedulerRunResultSchema>;

/** 任务策略（持久化记录；时间戳为 ISO 8601） */
export const systemSchedulerTaskConfigSchema = z.object({
  taskName: z.string(),
  enabled: z.boolean(),
  logRetentionDays: z.int(),
  logRetentionRuns: z.int(),
  timeoutMs: z.int().nullable(),
  failureAlertThreshold: z.int(),
  alertEnabled: z.boolean(),
  alertChannels: z.array(z.enum(SYSTEM_SCHEDULER_ALERT_CHANNELS)),
  alertUserIds: z.array(z.int()),
  alertEmails: z.array(z.string()),
  alertWebhookUrl: z.string().nullable(),
  manualSingleton: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SystemSchedulerTaskConfig' });

export type SystemSchedulerTaskConfig = z.infer<typeof systemSchedulerTaskConfigSchema>;

export const systemSchedulerCleanupResultSchema = z.object({
  message: z.string(),
  deletedByAge: z.int(),
  deletedByCount: z.int(),
  totalBefore: z.int(),
  totalAfter: z.int(),
}).meta({ id: 'SystemSchedulerCleanupResult' });

export type SystemSchedulerCleanupResult = z.infer<typeof systemSchedulerCleanupResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const systemSchedulerRunListQuery = paginationQuery.extend({
  taskName: z.string().optional(),
  taskType: z.enum(SYSTEM_SCHEDULER_TASK_TYPES).optional(),
  triggerType: z.enum(SYSTEM_SCHEDULER_TRIGGER_TYPES).optional(),
  status: z.enum(SYSTEM_SCHEDULER_RUN_STATUSES).optional(),
  alertStatus: z.enum(SYSTEM_SCHEDULER_ALERT_FILTERS).optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const systemSchedulerCleanupQuery = z.object({
  taskName: z.string().optional().meta({ description: '只清理该任务的运行日志；缺省清理全部' }),
});

export const systemSchedulerTaskNameParam = z.object({
  name: z.string().min(1).meta({ description: '系统调度任务标识', example: 'export-file-cleanup' }),
});

export const systemSchedulerContract = defineContract('/api/system-scheduler', {
  tasks: op.get('/tasks', { response: z.array(systemSchedulerTaskSchema), summary: '系统调度任务列表' }),
  runs: op.get('/runs', { query: systemSchedulerRunListQuery, response: paginated(systemSchedulerRunSchema), summary: '系统调度运行日志' }),
  cleanupRuns: op.post('/runs/cleanup', { query: systemSchedulerCleanupQuery, response: systemSchedulerCleanupResultSchema, summary: '手动清理系统调度运行日志' }),
  runDetail: op.get('/runs/{id}', { params: idParam, response: systemSchedulerRunSchema, summary: '系统调度运行日志详情' }),
  acknowledgeAlert: op.post('/runs/{id}/ack-alert', {
    params: idParam,
    body: acknowledgeSystemSchedulerAlertSchema,
    response: systemSchedulerRunSchema,
    summary: '确认系统调度告警',
  }),
  nodes: op.get('/nodes', { query: paginationQuery, response: paginated(systemSchedulerNodeSchema), summary: '系统调度节点列表' }),
  runTask: op.post('/tasks/{name}/run', { params: systemSchedulerTaskNameParam, response: systemSchedulerRunResultSchema, summary: '手动执行系统周期任务' }),
  updateTaskConfig: op.put('/tasks/{name}/config', {
    params: systemSchedulerTaskNameParam,
    body: updateSystemSchedulerTaskConfigSchema,
    response: systemSchedulerTaskConfigSchema,
    summary: '更新系统调度任务策略',
  }),
}, { tags: ['SystemScheduler'] });
