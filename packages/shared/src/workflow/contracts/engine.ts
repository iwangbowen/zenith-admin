import * as z from 'zod';
import { batchIdsBody, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { systemSchedulerTaskBaseSchema } from '../../platform/contracts';
import {
  WORKFLOW_DEFINITION_STATUSES,
  WORKFLOW_ENGINE_ACTION_KEYS,
  WORKFLOW_ENGINE_COMPONENT_KEYS,
  WORKFLOW_ENGINE_COMPONENT_STATUSES,
  WORKFLOW_ENGINE_QUEUE_KEYS,
  WORKFLOW_EVENT_TYPES,
  WORKFLOW_INSTANCE_PRIORITIES,
  WORKFLOW_JOB_EXECUTION_STATUSES,
  WORKFLOW_JOB_STATUSES,
  WORKFLOW_JOB_TYPES,
  WORKFLOW_RUNTIME_ISSUE_SEVERITIES,
  WORKFLOW_TASK_EXTERNAL_DISPATCH_STATUSES,
  WORKFLOW_TASK_STATUSES,
  WORKFLOW_TRIGGER_EXECUTION_STATUSES,
} from '../constants';
import {
  workflowEngineActionFilterSchema,
  workflowJobBatchRetrySchema,
  workflowJobReplayFilterSchema,
  workflowJobReplaySchema,
  workflowJobRetrySchema,
} from '../validation';
import { workflowDiagnosticBundleSchema } from './instance-ops';
import { workflowTriggerExecutionSchema } from './trigger-executions';

// ─── 作业账本 ────────────────────────────────────────────────────────────────

export const workflowJobSchema = z.object({
  id: z.int(),
  jobType: z.enum(WORKFLOW_JOB_TYPES),
  status: z.enum(WORKFLOW_JOB_STATUSES),
  instanceId: z.int().nullable(),
  instanceTitle: z.string().nullable(),
  definitionName: z.string().nullable(),
  taskId: z.int().nullable(),
  nodeKey: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  traceId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  priority: z.int(),
  attempts: z.int(),
  maxAttempts: z.int(),
  runAt: z.string(),
  lockedAt: z.string().nullable(),
  lockedBy: z.string().nullable().meta({ description: '最后领取该作业的 worker 节点（hostname:pid）' }),
  lastError: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'WorkflowJob' });

export type WorkflowJob = z.infer<typeof workflowJobSchema>;

export const workflowJobExecutionSchema = z.object({
  id: z.int(),
  jobId: z.int(),
  jobType: z.enum(WORKFLOW_JOB_TYPES),
  attempt: z.int(),
  status: z.enum(WORKFLOW_JOB_EXECUTION_STATUSES),
  requestUrl: z.string().nullable(),
  requestMethod: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseStatus: z.int().nullable(),
  responseBody: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.int().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowJobExecution' });

export type WorkflowJobExecution = z.infer<typeof workflowJobExecutionSchema>;

export const workflowJobDetailSchema = workflowJobSchema.extend({
  executions: z.array(workflowJobExecutionSchema),
}).meta({ id: 'WorkflowJobDetail' });

export type WorkflowJobDetail = z.infer<typeof workflowJobDetailSchema>;

/** 链路视图：同一 traceId 关联的全部作业（一次操作的完整异步 fan-out）+ 执行明细 + 状态统计 */
export const workflowJobChainSchema = z.object({
  traceId: z.string(),
  jobs: z.array(workflowJobDetailSchema),
  stats: z.object({
    total: z.int(),
    pending: z.int(),
    running: z.int(),
    succeeded: z.int(),
    failed: z.int(),
    dead: z.int(),
    canceled: z.int(),
    instanceIds: z.array(z.int()).meta({ description: '链路涉及的实例 ID（跨实例 / 子流程时 > 1）' }),
  }),
}).meta({ id: 'WorkflowJobChain' });

export type WorkflowJobChain = z.infer<typeof workflowJobChainSchema>;

/** traceId 诊断包：作业链路 + 该 traceId 涉及的各实例诊断包 */
export const workflowTraceDiagnosticBundleSchema = z.object({
  traceId: z.string(),
  generatedAt: z.string(),
  chain: workflowJobChainSchema,
  instances: z.array(workflowDiagnosticBundleSchema),
}).meta({ id: 'WorkflowTraceDiagnosticBundle' });

export type WorkflowTraceDiagnosticBundle = z.infer<typeof workflowTraceDiagnosticBundleSchema>;

/** 按作业类型聚合的状态计数（作业账本 Tab 徽标） */
export const workflowJobSummaryItemSchema = z.object({
  jobType: z.enum(WORKFLOW_JOB_TYPES),
  total: z.int(),
  pending: z.int(),
  running: z.int(),
  succeeded: z.int(),
  failed: z.int(),
  dead: z.int(),
  canceled: z.int(),
}).meta({ id: 'WorkflowJobSummaryItem' });

export type WorkflowJobSummaryItem = z.infer<typeof workflowJobSummaryItemSchema>;

export const workflowJobBatchResultSchema = z.object({
  total: z.int(),
  success: z.int(),
  skipped: z.int(),
}).meta({ id: 'WorkflowJobBatchResult' });

export type WorkflowJobBatchResult = z.infer<typeof workflowJobBatchResultSchema>;

export const workflowJobReplayPreviewSchema = z.object({
  matched: z.int(),
}).meta({ id: 'WorkflowJobReplayPreview' });

export type WorkflowJobReplayPreview = z.infer<typeof workflowJobReplayPreviewSchema>;

/** 死信重放结果（含匹配总数与实际生效限流） */
export const workflowJobReplayResultSchema = workflowJobBatchResultSchema.extend({
  matched: z.int(),
  ratePerSecond: z.int(),
  limit: z.int(),
}).meta({ id: 'WorkflowJobReplayResult' });

export type WorkflowJobReplayResult = z.infer<typeof workflowJobReplayResultSchema>;

export const WORKFLOW_JOB_CLUSTER_DIMENSIONS = ['reason', 'jobType', 'instance', 'trace'] as const;

export type WorkflowJobClusterDimension = (typeof WORKFLOW_JOB_CLUSTER_DIMENSIONS)[number];

/** 聚类簇内的成员作业明细 */
export const workflowJobFailureClusterMemberSchema = z.object({
  id: z.int(),
  jobType: z.string(),
  status: z.string(),
  instanceId: z.int().nullable(),
  instanceTitle: z.string().nullable(),
  definitionName: z.string().nullable(),
  nodeKey: z.string().nullable(),
  attempts: z.int(),
  maxAttempts: z.int(),
  lockedBy: z.string().nullable().meta({ description: '最后领取该作业的 worker 节点（hostname:pid）' }),
  traceId: z.string().nullable(),
  lastError: z.string().nullable().meta({ description: '完整原始错误' }),
  failedAt: z.string().meta({ description: '最近失败时间' }),
  createdAt: z.string(),
}).meta({ id: 'WorkflowJobFailureClusterMember' });

export type WorkflowJobFailureClusterMember = z.infer<typeof workflowJobFailureClusterMemberSchema>;

/** 失败聚类项（多维，支持对某簇直接重放） */
export const workflowJobFailureClusterSchema = z.object({
  dimension: z.enum(WORKFLOW_JOB_CLUSTER_DIMENSIONS),
  key: z.string(),
  label: z.string(),
  count: z.int(),
  jobTypes: z.array(z.string()),
  instanceId: z.int().nullable(),
  traceId: z.string().nullable(),
  reasonKeyword: z.string().nullable(),
  firstAt: z.string().nullable().meta({ description: '簇内最早失败时间' }),
  lastAt: z.string().nullable().meta({ description: '簇内最近失败时间' }),
  instanceCount: z.int().meta({ description: '涉及的流程实例数' }),
  jobs: z.array(workflowJobFailureClusterMemberSchema).meta({ description: '成员作业明细（按最近失败倒序，最多 10 条）' }),
}).meta({ id: 'WorkflowJobFailureCluster' });

export type WorkflowJobFailureCluster = z.infer<typeof workflowJobFailureClusterSchema>;

/** 作业平台运行状态（worker 心跳聚合 + 作业维度派生指标） */
export const workflowJobRuntimeStatusSchema = z.object({
  activeWorkers: z.int().meta({ description: '存活 worker（心跳新鲜的调度节点）数' }),
  totalWorkers: z.int(),
  workers: z.array(z.object({
    nodeId: z.string(),
    hostname: z.string().nullable(),
    runningJobCount: z.int(),
    lastHeartbeatAt: z.string().nullable(),
    fresh: z.boolean(),
  })),
  runningJobs: z.int(),
  stuckRunningJobs: z.int().meta({ description: 'running 且锁定超过宽限期的作业数' }),
  backlog: z.int().meta({ description: '到期待处理（pending 且 runAt<=now）作业数' }),
  deadLetter: z.int(),
  lastClaimedAt: z.string().nullable(),
  failureRate: z.number().meta({ description: '近 60 分钟执行失败率（%）' }),
  avgDurationMs: z.int().nullable(),
  recentExecutions: z.int(),
}).meta({ id: 'WorkflowJobRuntimeStatus' });

export type WorkflowJobRuntimeStatus = z.infer<typeof workflowJobRuntimeStatusSchema>;

// ─── 引擎内省 ────────────────────────────────────────────────────────────────

export const workflowEngineMetricSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  status: z.enum(WORKFLOW_ENGINE_COMPONENT_STATUSES).nullable().optional(),
}).meta({ id: 'WorkflowEngineMetric' });

export type WorkflowEngineMetric = z.infer<typeof workflowEngineMetricSchema>;

export const workflowEngineComponentSchema = z.object({
  key: z.enum(WORKFLOW_ENGINE_COMPONENT_KEYS),
  name: z.string(),
  status: z.enum(WORKFLOW_ENGINE_COMPONENT_STATUSES),
  description: z.string(),
  metrics: z.array(workflowEngineMetricSchema),
  internals: z.record(z.string(), z.unknown()).nullable().optional(),
}).meta({ id: 'WorkflowEngineComponent' });

export type WorkflowEngineComponent = z.infer<typeof workflowEngineComponentSchema>;

export const workflowEngineQueueSnapshotSchema = z.object({
  key: z.enum(WORKFLOW_ENGINE_QUEUE_KEYS),
  name: z.string(),
  status: z.enum(WORKFLOW_ENGINE_COMPONENT_STATUSES),
  ready: z.int(),
  running: z.int(),
  delayed: z.int(),
  failed: z.int(),
  oldestAgeMinutes: z.int().nullable(),
  details: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).nullable().optional(),
}).meta({ id: 'WorkflowEngineQueueSnapshot' });

export type WorkflowEngineQueueSnapshot = z.infer<typeof workflowEngineQueueSnapshotSchema>;

export const workflowEngineDefinitionValidationItemSchema = z.object({
  definitionId: z.int(),
  name: z.string(),
  status: z.enum(WORKFLOW_DEFINITION_STATUSES),
  version: z.int(),
  errors: z.array(z.string()),
}).meta({ id: 'WorkflowEngineDefinitionValidationItem' });

export type WorkflowEngineDefinitionValidationItem = z.infer<typeof workflowEngineDefinitionValidationItemSchema>;

export const workflowEngineDefinitionSnapshotSchema = z.object({
  total: z.int(),
  published: z.int(),
  invalid: z.int(),
  invalidPublished: z.int(),
  nodeTypeCounts: z.record(z.string(), z.int()),
  edgeCount: z.int(),
  invalidDefinitions: z.array(workflowEngineDefinitionValidationItemSchema),
}).meta({ id: 'WorkflowEngineDefinitionSnapshot' });

export type WorkflowEngineDefinitionSnapshot = z.infer<typeof workflowEngineDefinitionSnapshotSchema>;

export const workflowEngineEventBusSnapshotSchema = z.object({
  totalListenerCount: z.int(),
  listeners: z.array(z.object({
    eventType: z.union([z.enum(WORKFLOW_EVENT_TYPES), z.literal('__any__')]),
    listenerCount: z.int(),
  })),
}).meta({ id: 'WorkflowEngineEventBusSnapshot' });

export type WorkflowEngineEventBusSnapshot = z.infer<typeof workflowEngineEventBusSnapshotSchema>;

export const workflowEngineSchedulerSnapshotSchema = z.object({
  initialized: z.boolean(),
  runningJobCount: z.int(),
  node: z.object({ id: z.string(), hostname: z.string(), pid: z.int() }),
  registeredHandlers: z.array(z.string()),
  systemRecurringJobs: z.array(systemSchedulerTaskBaseSchema.extend({ taskType: z.literal('recurring'), cronExpression: z.string() })),
  systemQueueWorkers: z.array(systemSchedulerTaskBaseSchema.extend({ taskType: z.literal('queue'), cronExpression: z.null(), allowManualRun: z.literal(false) })),
  wip: z.array(z.object({ name: z.string(), count: z.int() })),
}).meta({ id: 'WorkflowEngineSchedulerSnapshot' });

export type WorkflowEngineSchedulerSnapshot = z.infer<typeof workflowEngineSchedulerSnapshotSchema>;

export const workflowEngineRuntimeTaskSchema = z.object({
  queue: z.enum(WORKFLOW_ENGINE_QUEUE_KEYS),
  taskId: z.int(),
  instanceId: z.int(),
  instanceTitle: z.string(),
  serialNo: z.string().nullable(),
  definitionId: z.int(),
  definitionName: z.string(),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string().nullable(),
  status: z.enum(WORKFLOW_TASK_STATUSES),
  assigneeId: z.int().nullable(),
  assigneeName: z.string().nullable(),
  priority: z.enum(WORKFLOW_INSTANCE_PRIORITIES),
  externalCallbackId: z.string().nullable(),
  externalDispatchStatus: z.enum(WORKFLOW_TASK_EXTERNAL_DISPATCH_STATUSES).nullable(),
  triggerDispatchStatus: z.enum(WORKFLOW_TRIGGER_EXECUTION_STATUSES).nullable(),
  triggerAttempt: z.int(),
  triggerNextRetryAt: z.string().nullable(),
  triggerLastError: z.string().nullable(),
  timeoutAt: z.string().nullable(),
  wakeAt: z.string().nullable(),
  ageMinutes: z.int(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowEngineRuntimeTask' });

export type WorkflowEngineRuntimeTask = z.infer<typeof workflowEngineRuntimeTaskSchema>;

export const workflowEngineOutboxEventSchema = z.object({
  id: z.int(),
  eventId: z.string(),
  eventType: z.string(),
  instanceId: z.int().nullable(),
  instanceTitle: z.string().nullable(),
  taskId: z.int().nullable(),
  status: z.string(),
  attempts: z.int(),
  errorMessage: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  processedAt: z.string().nullable(),
  ageMinutes: z.int(),
  createdAt: z.string(),
}).meta({ id: 'WorkflowEngineOutboxEvent' });

export type WorkflowEngineOutboxEvent = z.infer<typeof workflowEngineOutboxEventSchema>;

export const workflowEngineTriggerExecutionSchema = workflowTriggerExecutionSchema.extend({
  instanceTitle: z.string().nullable(),
}).meta({ id: 'WorkflowEngineTriggerExecution' });

export type WorkflowEngineTriggerExecution = z.infer<typeof workflowEngineTriggerExecutionSchema>;

export const workflowEngineRuntimeIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(WORKFLOW_RUNTIME_ISSUE_SEVERITIES),
  component: z.enum(WORKFLOW_ENGINE_COMPONENT_KEYS),
  title: z.string(),
  description: z.string(),
  refType: z.enum(['definition', 'instance', 'task', 'triggerExecution', 'outbox', 'scheduler']).nullable().optional(),
  refId: z.int().nullable().optional(),
  instanceId: z.int().nullable().optional().meta({ description: '关联实例 ID（可跳转实例诊断处置；平台级问题为 null）' }),
  ageMinutes: z.int().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).meta({ id: 'WorkflowEngineRuntimeIssue' });

export type WorkflowEngineRuntimeIssue = z.infer<typeof workflowEngineRuntimeIssueSchema>;

export const workflowEngineRuntimeSnapshotSchema = z.object({
  runningInstances: z.int(),
  activeTokens: z.int().meta({ description: '平台内运行实例的活动执行 Token 总数' }),
  runningWithoutActiveTasks: z.array(z.object({
    instanceId: z.int(),
    title: z.string(),
    serialNo: z.string().nullable(),
    definitionId: z.int(),
    definitionName: z.string().nullable(),
    currentNodeKey: z.string().nullable(),
    ageMinutes: z.int(),
    createdAt: z.string(),
  })),
  taskQueue: z.array(workflowEngineRuntimeTaskSchema),
  triggerExecutions: z.array(workflowEngineTriggerExecutionSchema),
  outboxEvents: z.array(workflowEngineOutboxEventSchema),
}).meta({ id: 'WorkflowEngineRuntimeSnapshot' });

export type WorkflowEngineRuntimeSnapshot = z.infer<typeof workflowEngineRuntimeSnapshotSchema>;

export const workflowEngineThroughputWindowSchema = z.object({
  total: z.int(),
  success: z.int(),
  failed: z.int(),
}).meta({ id: 'WorkflowEngineThroughputWindow' });

export type WorkflowEngineThroughputWindow = z.infer<typeof workflowEngineThroughputWindowSchema>;

export const workflowEngineEventBucketSchema = z.object({
  hour: z.string().meta({ description: '小时桶起点，格式 YYYY-MM-DD HH:mm:ss' }),
  total: z.int(),
  success: z.int(),
  failed: z.int(),
}).meta({ id: 'WorkflowEngineEventBucket' });

export type WorkflowEngineEventBucket = z.infer<typeof workflowEngineEventBucketSchema>;

export const workflowEngineInstanceBucketSchema = z.object({
  hour: z.string(),
  created: z.int(),
  completed: z.int(),
}).meta({ id: 'WorkflowEngineInstanceBucket' });

export type WorkflowEngineInstanceBucket = z.infer<typeof workflowEngineInstanceBucketSchema>;

/** 健康分扣分归因项 */
export const workflowEngineScoreFactorSchema = z.object({
  reason: z.string(),
  delta: z.number().meta({ description: '扣分值（正数，表示从 100 中扣减多少）' }),
  severity: z.enum(['warning', 'critical']),
}).meta({ id: 'WorkflowEngineScoreFactor' });

export type WorkflowEngineScoreFactor = z.infer<typeof workflowEngineScoreFactorSchema>;

export const workflowEngineHistogramBucketSchema = z.object({
  label: z.string(),
  min: z.number().meta({ description: '桶下界（毫秒，含）' }),
  max: z.number().nullable().meta({ description: '桶上界（毫秒，不含）；null 表示无上界' }),
  count: z.int(),
}).meta({ id: 'WorkflowEngineHistogramBucket' });

export type WorkflowEngineHistogramBucket = z.infer<typeof workflowEngineHistogramBucketSchema>;

/** Apdex 满意度（基于事件处理延迟，T = 满意阈值，4T = 容忍阈值） */
export const workflowEngineApdexSchema = z.object({
  score: z.number().nullable().meta({ description: 'Apdex 分值 0-1；样本为 0 时为 null' }),
  thresholdMs: z.number(),
  satisfied: z.int(),
  tolerating: z.int(),
  frustrated: z.int(),
  total: z.int(),
}).meta({ id: 'WorkflowEngineApdex' });

export type WorkflowEngineApdex = z.infer<typeof workflowEngineApdexSchema>;

/** 可配置阈值（来自 system_configs，回显给前端用于解释判定口径） */
export const workflowEngineThresholdsSchema = z.object({
  healthWarn: z.number(),
  healthCritical: z.number(),
  backlogWarn: z.number(),
  backlogCritical: z.number(),
  errorRateWarn: z.number(),
  errorRateCritical: z.number(),
}).meta({ id: 'WorkflowEngineThresholds' });

export type WorkflowEngineThresholds = z.infer<typeof workflowEngineThresholdsSchema>;

const triggerWindowSchema = z.object({ total: z.int(), success: z.int(), failed: z.int(), retrying: z.int() });

/** 引擎遥测指标：只承载“只能由后端计算”的数据 */
export const workflowEngineTelemetrySchema = z.object({
  healthScore: z.int().meta({ description: '引擎健康分 0-100' }),
  scoreBreakdown: z.array(workflowEngineScoreFactorSchema),
  apdex: workflowEngineApdexSchema,
  events: z.object({
    last1h: workflowEngineThroughputWindowSchema,
    last24h: workflowEngineThroughputWindowSchema,
    prev24h: workflowEngineThroughputWindowSchema,
    pendingRetry: z.int(),
    avgLatencyMs: z.number().nullable(),
    p95LatencyMs: z.number().nullable(),
    p99LatencyMs: z.number().nullable(),
    latencyHistogram: z.array(workflowEngineHistogramBucketSchema),
    series24h: z.array(workflowEngineEventBucketSchema),
  }),
  triggers: z.object({
    last24h: triggerWindowSchema,
    prev24h: triggerWindowSchema,
    avgDurationMs: z.number().nullable(),
    p95DurationMs: z.number().nullable(),
    p99DurationMs: z.number().nullable(),
    durationHistogram: z.array(workflowEngineHistogramBucketSchema),
  }),
  instances: z.object({
    running: z.int(),
    createdLast24h: z.int(),
    completedLast24h: z.int(),
    canceledLast24h: z.int(),
    createdPrev24h: z.int(),
    completedPrev24h: z.int(),
    series24h: z.array(workflowEngineInstanceBucketSchema),
  }),
  recurringJobs: z.array(z.object({
    name: z.string(),
    cronExpression: z.string(),
    registeredAt: z.string(),
    nextRunAt: z.string().nullable(),
  })),
}).meta({ id: 'WorkflowEngineTelemetry' });

export type WorkflowEngineTelemetry = z.infer<typeof workflowEngineTelemetrySchema>;

export const workflowEngineIntrospectionSchema = z.object({
  healthy: z.boolean(),
  generatedAt: z.string(),
  thresholdMinutes: z.int(),
  thresholds: workflowEngineThresholdsSchema,
  telemetry: workflowEngineTelemetrySchema,
  components: z.array(workflowEngineComponentSchema),
  queues: z.array(workflowEngineQueueSnapshotSchema),
  definitions: workflowEngineDefinitionSnapshotSchema,
  eventBus: workflowEngineEventBusSnapshotSchema,
  scheduler: workflowEngineSchedulerSnapshotSchema,
  runtime: workflowEngineRuntimeSnapshotSchema,
  issues: z.array(workflowEngineRuntimeIssueSchema),
}).meta({ id: 'WorkflowEngineIntrospection' });

export type WorkflowEngineIntrospection = z.infer<typeof workflowEngineIntrospectionSchema>;

/** 健康历史趋势单点（由定时任务 platform-wide 采集） */
export const workflowEngineHealthPointSchema = z.object({
  capturedAt: z.string(),
  healthScore: z.int(),
  severity: z.enum(WORKFLOW_ENGINE_COMPONENT_STATUSES),
  backlog: z.int(),
  errorRate: z.number().meta({ description: '事件错误率 0-1' }),
  criticalCount: z.int(),
  warningCount: z.int(),
  runningInstances: z.int(),
}).meta({ id: 'WorkflowEngineHealthPoint' });

export type WorkflowEngineHealthPoint = z.infer<typeof workflowEngineHealthPointSchema>;

export const workflowEngineHealthHistorySchema = z.object({
  points: z.array(workflowEngineHealthPointSchema).meta({ description: '时间升序排列的健康趋势点' }),
  thresholds: workflowEngineThresholdsSchema,
}).meta({ id: 'WorkflowEngineHealthHistory' });

export type WorkflowEngineHealthHistory = z.infer<typeof workflowEngineHealthHistorySchema>;

// ─── 运维动作 ────────────────────────────────────────────────────────────────

export const workflowEngineActionResultSchema = z.object({
  action: z.enum(WORKFLOW_ENGINE_ACTION_KEYS),
  ok: z.boolean(),
  message: z.string(),
  detail: z.record(z.string(), z.number()).meta({ description: '各动作返回的原始计数（scanned / dispatched / resumed 等）' }),
}).meta({ id: 'WorkflowEngineActionResult' });

export type WorkflowEngineActionResult = z.infer<typeof workflowEngineActionResultSchema>;

/** 运维动作预览样本行 */
export const workflowEngineActionSampleJobSchema = z.object({
  id: z.int(),
  jobType: z.enum(WORKFLOW_JOB_TYPES),
  status: z.enum(WORKFLOW_JOB_STATUSES),
  instanceId: z.int().nullable(),
  traceId: z.string().nullable(),
  attempts: z.int(),
  runAt: z.string(),
  createdAt: z.string(),
  lastError: z.string().nullable(),
}).meta({ id: 'WorkflowEngineActionSampleJob' });

export type WorkflowEngineActionSampleJob = z.infer<typeof workflowEngineActionSampleJobSchema>;

/** 运维动作预览结果：筛选后将被处理的作业统计 + 样本 */
export const workflowEngineActionPreviewSchema = z.object({
  action: z.enum(WORKFLOW_ENGINE_ACTION_KEYS),
  label: z.string(),
  jobTypes: z.array(z.enum(WORKFLOW_JOB_TYPES)),
  duePending: z.int().meta({ description: 'pending 且已到期——将被处理' }),
  stuckRunning: z.int().meta({ description: 'running 卡死——将被回收重跑' }),
  scheduledLater: z.int().meta({ description: 'pending 但未到期——本次不处理' }),
  matched: z.int(),
  limit: z.int(),
  sample: z.array(workflowEngineActionSampleJobSchema),
}).meta({ id: 'WorkflowEngineActionPreview' });

export type WorkflowEngineActionPreview = z.infer<typeof workflowEngineActionPreviewSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const workflowEngineThresholdQuery = z.object({
  thresholdMinutes: z.coerce.number().int().min(1).max(24 * 60).optional().meta({ description: '卡滞判定阈值（分钟），默认 30' }),
});

export const workflowEngineHealthHistoryQuery = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).optional().meta({ description: '回看小时数，默认 24' }),
});

export const workflowEngineActionParam = z.object({
  action: z.enum(WORKFLOW_ENGINE_ACTION_KEYS).meta({ description: '运维动作' }),
});

export const workflowJobListQuery = paginationQuery.extend({
  jobType: z.enum(WORKFLOW_JOB_TYPES).optional(),
  status: z.enum(WORKFLOW_JOB_STATUSES).optional(),
  instanceId: z.coerce.number().int().positive().optional(),
  keyword: z.string().optional().meta({ description: '按幂等键 / traceId / 节点 key 模糊匹配' }),
});

export const workflowJobTraceParam = z.object({
  traceId: z.string().min(1).max(64).meta({ description: '链路 ID' }),
});

export const workflowJobFailureClusterQuery = z.object({
  dimension: z.enum(WORKFLOW_JOB_CLUSTER_DIMENSIONS).optional().meta({ description: '聚类维度，默认 reason' }),
});

export const workflowEngineContract = defineContract('/api/workflows/engine', {
  introspection: op.get('/introspection', { query: workflowEngineThresholdQuery, response: workflowEngineIntrospectionSchema, summary: '流程引擎内部状态内省' }),
  healthHistory: op.get('/health-history', { query: workflowEngineHealthHistoryQuery, response: workflowEngineHealthHistorySchema, summary: '流程引擎健康趋势历史' }),
  runAction: op.post('/actions/{action}', { params: workflowEngineActionParam, body: workflowEngineActionFilterSchema, response: workflowEngineActionResultSchema, summary: '执行流程引擎运维恢复动作（支持按实例 / 入库时长 / 上限筛选）' }),
  previewAction: op.post('/actions/{action}/preview', { params: workflowEngineActionParam, body: workflowEngineActionFilterSchema, response: workflowEngineActionPreviewSchema, summary: '运维恢复动作预览（按筛选统计将处理的作业 + 样本，不执行）' }),
  jobs: op.get('/jobs', { query: workflowJobListQuery, response: paginated(workflowJobSchema), summary: '工作流作业账本列表' }),
  jobsSummary: op.get('/jobs/summary', { response: z.array(workflowJobSummaryItemSchema), summary: '按作业类型聚合的状态计数' }),
  jobChain: op.get('/jobs/chain/{traceId}', { params: workflowJobTraceParam, response: workflowJobChainSchema, summary: '工作流作业链路（同 traceId 的完整异步 fan-out，含跨实例/子流程串联）' }),
  jobChainBundle: op.get('/jobs/chain/{traceId}/diagnostic-bundle', { params: workflowJobTraceParam, response: workflowTraceDiagnosticBundleSchema, summary: 'traceId 诊断包（作业链路 + 涉及实例诊断聚合，供工单留档/离线分析）' }),
  batchRetryJobs: op.post('/jobs/batch-retry', { body: workflowJobBatchRetrySchema, response: workflowJobBatchResultSchema, summary: '批量重试作业' }),
  batchSkipJobs: op.post('/jobs/batch-skip', { body: batchIdsBody, response: workflowJobBatchResultSchema, summary: '批量跳过作业' }),
  replayDeadJobs: op.post('/jobs/replay-dead', { body: workflowJobReplaySchema, response: workflowJobReplayResultSchema, summary: '死信中心：按条件 + 限流重放死信作业' }),
  replayPreview: op.post('/jobs/replay-preview', { body: workflowJobReplayFilterSchema, response: workflowJobReplayPreviewSchema, summary: '死信中心：条件重放预览（仅统计匹配数）' }),
  failureClusters: op.get('/jobs/failure-clusters', { query: workflowJobFailureClusterQuery, response: z.array(workflowJobFailureClusterSchema), summary: '失败原因多维聚类' }),
  jobRuntimeStatus: op.get('/jobs/runtime-status', { response: workflowJobRuntimeStatusSchema, summary: '作业平台运行状态（worker 心跳 + 派生指标）' }),
  jobDetail: op.get('/jobs/{id}', { params: idParam, response: workflowJobDetailSchema, summary: '工作流作业详情（含执行记录）' }),
  retryJob: op.post('/jobs/{id}/retry', { params: idParam, body: workflowJobRetrySchema, response: workflowJobSchema, summary: '重试 / 改参重放作业' }),
  skipJob: op.post('/jobs/{id}/skip', { params: idParam, response: workflowJobSchema, summary: '跳过 / 取消作业' }),
}, { tags: ['WorkflowEngine'] });
