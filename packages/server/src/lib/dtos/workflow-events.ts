/**
 * 工作流事件订阅 / 投递 / 触发器执行 / 外部回调 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';
import { WorkflowInstanceDTO, WorkflowTaskDTO } from './workflow';
import { WorkflowInstanceTraceDTO } from './workflow-trace';

export const WorkflowEventSubscriptionDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    definitionId: z.number().int().nullable(),
    definitionName: z.string().nullable().optional(),
    events: z.array(z.string()),
    url: z.string(),
    /** 已脱敏后的 secret 字符串，例如 `abcd****wxyz` */
    secretMasked: z.string().nullable(),
    signMode: z.enum(['hmacSha256', 'none']),
    headers: z.record(z.string(), z.string()).nullable(),
    connectorId: z.number().int().nullable(),
    enabled: z.boolean(),
    tenantId: z.number().int().nullable(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('WorkflowEventSubscription');

export const WorkflowEventSubscriptionSecretDTO = z
  .object({
    id: z.number().int(),
    secret: z.string().nullable(),
  })
  .openapi('WorkflowEventSubscriptionSecret');

export const WorkflowEventDeliveryDTO = z
  .object({
    id: z.number().int(),
    subscriptionId: z.number().int(),
    subscriptionName: z.string().nullable().optional(),
    instanceId: z.number().int().nullable(),
    taskId: z.number().int().nullable(),
    eventId: z.string(),
    eventType: z.string(),
    payload: z.unknown().nullable(),
    attempt: z.number().int(),
    status: z.enum(['pending', 'success', 'failed', 'retrying']),
    requestUrl: z.string().nullable(),
    requestHeaders: z.record(z.string(), z.string()).nullable(),
    responseStatus: z.number().int().nullable(),
    responseBody: z.string().nullable(),
    errorMessage: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    nextRetryAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    tenantId: z.number().int().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowEventDelivery');

export const WorkflowTriggerExecutionDTO = z
  .object({
    id: z.number().int(),
    instanceId: z.number().int(),
    taskId: z.number().int().nullable(),
    nodeKey: z.string(),
    nodeName: z.string().nullable(),
    triggerType: z.string(),
    status: z.enum(['pending', 'running', 'success', 'failed', 'retrying']),
    attempt: z.number().int(),
    requestUrl: z.string().nullable(),
    requestMethod: z.string().nullable(),
    requestBody: z.string().nullable(),
    responseStatus: z.number().int().nullable(),
    responseBody: z.string().nullable(),
    errorMessage: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    tenantId: z.number().int().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowTriggerExecution');

export const WorkflowRuntimeOutboxEventDTO = z
  .object({
    id: z.number().int(),
    eventId: z.string(),
    eventType: z.string(),
    taskId: z.number().int().nullable(),
    status: z.string(),
    attempts: z.number().int(),
    errorMessage: z.string().nullable(),
    nextRetryAt: z.string().nullable(),
    processedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkflowRuntimeOutboxEvent');

export const WorkflowRuntimeIssueDTO = z
  .object({
    severity: z.enum(['info', 'warning', 'critical']),
    title: z.string(),
    description: z.string(),
    source: z.enum(['instance', 'task', 'trigger', 'outbox', 'token']),
    taskId: z.number().int().nullable().optional(),
    nodeKey: z.string().nullable().optional(),
  })
  .openapi('WorkflowRuntimeIssue');

export const WorkflowBranchFrameDTO = z
  .object({ id: z.string(), index: z.number().int(), total: z.number().int() })
  .openapi('WorkflowBranchFrame');

export const WorkflowExecutionTokenDTO = z
  .object({
    id: z.number().int(),
    nodeKey: z.string(),
    nodeName: z.string().nullable(),
    status: z.enum(['active', 'consumed', 'dead']),
    parkedAtJoin: z.boolean(),
    branchPath: z.array(WorkflowBranchFrameDTO),
    depth: z.number().int(),
    parentTokenId: z.number().int().nullable(),
    scopeKey: z.string().nullable(),
    createdAt: z.string(),
    consumedAt: z.string().nullable(),
  })
  .openapi('WorkflowExecutionToken');

export const WorkflowExecutionTokenViewDTO = z
  .object({
    instanceId: z.number().int(),
    activeCount: z.number().int(),
    parkedCount: z.number().int(),
    consumedCount: z.number().int(),
    deadCount: z.number().int(),
    tokens: z.array(WorkflowExecutionTokenDTO),
    generatedAt: z.string(),
  })
  .openapi('WorkflowExecutionTokenView');

export const WorkflowRuntimeDiagnosticsDTO = z
  .object({
    instance: WorkflowInstanceDTO,
    tasks: z.array(WorkflowTaskDTO),
    activeTasks: z.array(WorkflowTaskDTO),
    triggerExecutions: z.array(WorkflowTriggerExecutionDTO),
    outboxEvents: z.array(WorkflowRuntimeOutboxEventDTO),
    issues: z.array(WorkflowRuntimeIssueDTO),
    tokens: z.array(WorkflowExecutionTokenDTO),
    snapshot: z.object({
      formData: z.unknown().nullable(),
      formSnapshot: z.unknown().nullable(),
      definitionSnapshot: z.unknown().nullable(),
    }),
    generatedAt: z.string(),
  })
  .openapi('WorkflowRuntimeDiagnostics');

/** 实例诊断包：诊断 + 轨迹 + 执行 Token，供运营离线分析 / 工单留档 */
export const WorkflowDiagnosticBundleDTO = z
  .object({
    instanceId: z.number().int(),
    generatedAt: z.string(),
    diagnostics: WorkflowRuntimeDiagnosticsDTO,
    trace: WorkflowInstanceTraceDTO,
    tokens: WorkflowExecutionTokenViewDTO,
  })
  .openapi('WorkflowDiagnosticBundle');

/** 批量恢复结果汇总（批量推进卡死实例等运营恢复动作） */
export const WorkflowRecoveryBatchResultDTO = z
  .object({
    total: z.number().int(),
    success: z.number().int(),
    failed: z.number().int(),
  })
  .openapi('WorkflowRecoveryBatchResult');

export const WorkflowHealthIssueDTO = z
  .object({
    id: z.string(),
    type: z.enum([
      'external_dispatch_failed',
      'external_dispatch_pending',
      'trigger_waiting_no_execution',
      'trigger_execution_failed',
      'subprocess_waiting',
      'delay_overdue',
      'delay_missing_wake_job',
      'task_timeout_overdue',
      'workflow_event_outbox_failed',
      'workflow_event_outbox_pending',
      'waiting_task_stuck',
      'instance_stalled',
    ]),
    severity: z.enum(['warning', 'critical']),
    title: z.string(),
    description: z.string(),
    instanceId: z.number().int().nullable(),
    instanceTitle: z.string().nullable().optional(),
    taskId: z.number().int().nullable().optional(),
    nodeKey: z.string().nullable().optional(),
    nodeName: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    ageMinutes: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('WorkflowHealthIssue');

export const WorkflowHealthSummaryDTO = z
  .object({
    healthy: z.boolean(),
    checkedAt: z.string(),
    thresholdMinutes: z.number().int(),
    stats: z.object({
      total: z.number().int(),
      critical: z.number().int(),
      warning: z.number().int(),
      externalFailed: z.number().int(),
      triggerStuck: z.number().int(),
      subProcessStuck: z.number().int(),
      outboxFailed: z.number().int(),
    }),
    issues: z.array(WorkflowHealthIssueDTO),
  })
  .openapi('WorkflowHealthSummary');

const WorkflowEngineComponentStatusDTO = z.enum(['healthy', 'warning', 'critical']);
const WorkflowEngineComponentKeyDTO = z.enum([
  'dagExecutor',
  'taskMaterializer',
  'delayScheduler',
  'timeoutProcessor',
  'triggerDispatcher',
  'externalApprover',
  'subProcessRecovery',
  'eventBus',
  'outbox',
  'scheduler',
]);
const WorkflowEngineQueueKeyDTO = z.enum([
  'humanTasks',
  'delayWakeups',
  'timeouts',
  'triggerDispatch',
  'externalApprovals',
  'subProcessJoin',
  'eventOutbox',
]);

const WorkflowEngineMetricDTO = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  status: WorkflowEngineComponentStatusDTO.nullable().optional(),
});

const WorkflowEngineComponentDTO = z.object({
  key: WorkflowEngineComponentKeyDTO,
  name: z.string(),
  status: WorkflowEngineComponentStatusDTO,
  description: z.string(),
  metrics: z.array(WorkflowEngineMetricDTO),
  internals: z.record(z.string(), z.unknown()).nullable().optional(),
});

const WorkflowEngineQueueSnapshotDTO = z.object({
  key: WorkflowEngineQueueKeyDTO,
  name: z.string(),
  status: WorkflowEngineComponentStatusDTO,
  ready: z.number().int(),
  running: z.number().int(),
  delayed: z.number().int(),
  failed: z.number().int(),
  oldestAgeMinutes: z.number().int().nullable(),
  details: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).nullable().optional(),
});

const WorkflowEngineDefinitionValidationItemDTO = z.object({
  definitionId: z.number().int(),
  name: z.string(),
  status: z.enum(['draft', 'published', 'disabled']),
  version: z.number().int(),
  errors: z.array(z.string()),
});

const WorkflowEngineDefinitionSnapshotDTO = z.object({
  total: z.number().int(),
  published: z.number().int(),
  invalid: z.number().int(),
  invalidPublished: z.number().int(),
  nodeTypeCounts: z.record(z.string(), z.number().int()),
  edgeCount: z.number().int(),
  invalidDefinitions: z.array(WorkflowEngineDefinitionValidationItemDTO),
});

const WorkflowEngineEventBusSnapshotDTO = z.object({
  totalListenerCount: z.number().int(),
  listeners: z.array(z.object({
    eventType: z.string(),
    listenerCount: z.number().int(),
  })),
});

const WorkflowEngineSchedulerSnapshotDTO = z.object({
  initialized: z.boolean(),
  runningJobCount: z.number().int(),
  registeredHandlers: z.array(z.string()),
  systemRecurringJobs: z.array(z.object({
    name: z.string(),
    title: z.string(),
    module: z.string(),
    description: z.string().nullable(),
    taskType: z.enum(['recurring']),
    cronExpression: z.string(),
    registeredAt: z.string(),
    allowManualRun: z.boolean(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.enum(['running', 'success', 'failed']).nullable(),
    lastRunMessage: z.string().nullable(),
    lastDurationMs: z.number().int().nullable(),
  })),
  systemQueueWorkers: z.array(z.object({
    name: z.string(),
    title: z.string(),
    module: z.string(),
    description: z.string().nullable(),
    taskType: z.enum(['queue']),
    cronExpression: z.null(),
    registeredAt: z.string(),
    allowManualRun: z.literal(false),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.enum(['running', 'success', 'failed']).nullable(),
    lastRunMessage: z.string().nullable(),
    lastDurationMs: z.number().int().nullable(),
  })),
  wip: z.array(z.object({
    name: z.string(),
    count: z.number().int(),
  })),
});

const WorkflowEngineRuntimeTaskDTO = z.object({
  queue: WorkflowEngineQueueKeyDTO,
  taskId: z.number().int(),
  instanceId: z.number().int(),
  instanceTitle: z.string(),
  serialNo: z.string().nullable(),
  definitionId: z.number().int(),
  definitionName: z.string(),
  nodeKey: z.string(),
  nodeName: z.string(),
  nodeType: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'skipped', 'waiting']),
  assigneeId: z.number().int().nullable(),
  assigneeName: z.string().nullable(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  externalCallbackId: z.string().nullable(),
  externalDispatchStatus: z.enum(['pending', 'dispatched', 'failed', 'fallback']).nullable(),
  triggerDispatchStatus: z.enum(['pending', 'running', 'success', 'failed', 'retrying']).nullable(),
  triggerAttempt: z.number().int(),
  triggerNextRetryAt: z.string().nullable(),
  triggerLastError: z.string().nullable(),
  timeoutAt: z.string().nullable(),
  wakeAt: z.string().nullable(),
  ageMinutes: z.number().int(),
  createdAt: z.string(),
});

const WorkflowEngineOutboxEventDTO = z.object({
  id: z.number().int(),
  eventId: z.string(),
  eventType: z.string(),
  instanceId: z.number().int().nullable(),
  instanceTitle: z.string().nullable(),
  taskId: z.number().int().nullable(),
  status: z.string(),
  attempts: z.number().int(),
  errorMessage: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  processedAt: z.string().nullable(),
  ageMinutes: z.number().int(),
  createdAt: z.string(),
});

const WorkflowEngineTriggerExecutionDTO = WorkflowTriggerExecutionDTO.extend({
  instanceTitle: z.string().nullable(),
});

const WorkflowEngineRuntimeIssueDTO = z.object({
  id: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  component: WorkflowEngineComponentKeyDTO,
  title: z.string(),
  description: z.string(),
  refType: z.enum(['definition', 'instance', 'task', 'triggerExecution', 'outbox', 'scheduler']).nullable().optional(),
  refId: z.number().int().nullable().optional(),
  ageMinutes: z.number().int().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const WorkflowEngineRuntimeSnapshotDTO = z.object({
  runningInstances: z.number().int(),
  activeTokens: z.number().int(),
  runningWithoutActiveTasks: z.array(z.object({
    instanceId: z.number().int(),
    title: z.string(),
    serialNo: z.string().nullable(),
    definitionId: z.number().int(),
    definitionName: z.string().nullable(),
    currentNodeKey: z.string().nullable(),
    ageMinutes: z.number().int(),
    createdAt: z.string(),
  })),
  taskQueue: z.array(WorkflowEngineRuntimeTaskDTO),
  triggerExecutions: z.array(WorkflowEngineTriggerExecutionDTO),
  outboxEvents: z.array(WorkflowEngineOutboxEventDTO),
});

const WorkflowEngineThroughputWindowDTO = z.object({
  total: z.number().int(),
  success: z.number().int(),
  failed: z.number().int(),
});

const WorkflowEngineHistogramBucketDTO = z.object({
  label: z.string(),
  min: z.number(),
  max: z.number().nullable(),
  count: z.number().int(),
});

const WorkflowEngineTelemetryDTO = z.object({
  healthScore: z.number().int(),
  scoreBreakdown: z.array(z.object({
    reason: z.string(),
    delta: z.number(),
    severity: z.enum(['warning', 'critical']),
  })),
  apdex: z.object({
    score: z.number().nullable(),
    thresholdMs: z.number(),
    satisfied: z.number().int(),
    tolerating: z.number().int(),
    frustrated: z.number().int(),
    total: z.number().int(),
  }),
  events: z.object({
    last1h: WorkflowEngineThroughputWindowDTO,
    last24h: WorkflowEngineThroughputWindowDTO,
    prev24h: WorkflowEngineThroughputWindowDTO,
    pendingRetry: z.number().int(),
    avgLatencyMs: z.number().nullable(),
    p95LatencyMs: z.number().nullable(),
    p99LatencyMs: z.number().nullable(),
    latencyHistogram: z.array(WorkflowEngineHistogramBucketDTO),
    series24h: z.array(z.object({
      hour: z.string(),
      total: z.number().int(),
      success: z.number().int(),
      failed: z.number().int(),
    })),
  }),
  triggers: z.object({
    last24h: z.object({
      total: z.number().int(),
      success: z.number().int(),
      failed: z.number().int(),
      retrying: z.number().int(),
    }),
    prev24h: z.object({
      total: z.number().int(),
      success: z.number().int(),
      failed: z.number().int(),
      retrying: z.number().int(),
    }),
    avgDurationMs: z.number().nullable(),
    p95DurationMs: z.number().nullable(),
    p99DurationMs: z.number().nullable(),
    durationHistogram: z.array(WorkflowEngineHistogramBucketDTO),
  }),
  instances: z.object({
    running: z.number().int(),
    createdLast24h: z.number().int(),
    completedLast24h: z.number().int(),
    canceledLast24h: z.number().int(),
    createdPrev24h: z.number().int(),
    completedPrev24h: z.number().int(),
    series24h: z.array(z.object({
      hour: z.string(),
      created: z.number().int(),
      completed: z.number().int(),
    })),
  }),
  recurringJobs: z.array(z.object({
    name: z.string(),
    cronExpression: z.string(),
    registeredAt: z.string(),
    nextRunAt: z.string().nullable(),
  })),
});

const WorkflowEngineThresholdsDTO = z.object({
  healthWarn: z.number(),
  healthCritical: z.number(),
  backlogWarn: z.number(),
  backlogCritical: z.number(),
  errorRateWarn: z.number(),
  errorRateCritical: z.number(),
});

export const WorkflowEngineIntrospectionDTO = z
  .object({
    healthy: z.boolean(),
    generatedAt: z.string(),
    thresholdMinutes: z.number().int(),
    thresholds: WorkflowEngineThresholdsDTO,
    telemetry: WorkflowEngineTelemetryDTO,
    components: z.array(WorkflowEngineComponentDTO),
    queues: z.array(WorkflowEngineQueueSnapshotDTO),
    definitions: WorkflowEngineDefinitionSnapshotDTO,
    eventBus: WorkflowEngineEventBusSnapshotDTO,
    scheduler: WorkflowEngineSchedulerSnapshotDTO,
    runtime: WorkflowEngineRuntimeSnapshotDTO,
    issues: z.array(WorkflowEngineRuntimeIssueDTO),
  })
  .openapi('WorkflowEngineIntrospection');

export const WorkflowEngineHealthHistoryDTO = z
  .object({
    points: z.array(z.object({
      capturedAt: z.string(),
      healthScore: z.number().int(),
      severity: z.enum(['healthy', 'warning', 'critical']),
      backlog: z.number().int(),
      errorRate: z.number(),
      criticalCount: z.number().int(),
      warningCount: z.number().int(),
      runningInstances: z.number().int(),
    })),
    thresholds: WorkflowEngineThresholdsDTO,
  })
  .openapi('WorkflowEngineHealthHistory');

export const WorkflowEngineActionResultDTO = z
  .object({
    action: z.enum(['replay-outbox', 'recover-delays', 'recover-subprocess', 'process-timeouts', 'recover-triggers', 'recover-webhooks']),
    ok: z.boolean(),
    message: z.string(),
    detail: z.record(z.string(), z.number()),
  })
  .openapi('WorkflowEngineActionResult');

const WORKFLOW_ENGINE_ACTION_KEYS = ['replay-outbox', 'recover-delays', 'recover-subprocess', 'process-timeouts', 'recover-triggers', 'recover-webhooks'] as const;
const WORKFLOW_ENGINE_JOB_TYPES = [
  'delay_wake', 'task_timeout', 'trigger_dispatch', 'external_dispatch',
  'subprocess_spawn', 'subprocess_join', 'event_dispatch', 'webhook_delivery',
  'compensation_action',
] as const;
const WORKFLOW_ENGINE_JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'dead', 'canceled'] as const;

/** 运维动作筛选条件（jobType 由动作固定，此处为附加维度） */
export const WorkflowEngineActionFilterBody = z.object({
  instanceId: z.number().int().positive().optional(),
  olderThanMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

/** 运维动作预览样本行 */
export const WorkflowEngineActionSampleJobDTO = z
  .object({
    id: z.number().int(),
    jobType: z.enum(WORKFLOW_ENGINE_JOB_TYPES),
    status: z.enum(WORKFLOW_ENGINE_JOB_STATUSES),
    instanceId: z.number().int().nullable(),
    traceId: z.string().nullable(),
    attempts: z.number().int(),
    runAt: z.string(),
    createdAt: z.string(),
    lastError: z.string().nullable(),
  })
  .openapi('WorkflowEngineActionSampleJob');

/** 运维动作预览结果：筛选后将被处理的作业统计 + 样本 */
export const WorkflowEngineActionPreviewDTO = z
  .object({
    action: z.enum(WORKFLOW_ENGINE_ACTION_KEYS),
    label: z.string(),
    jobTypes: z.array(z.enum(WORKFLOW_ENGINE_JOB_TYPES)),
    duePending: z.number().int(),
    stuckRunning: z.number().int(),
    scheduledLater: z.number().int(),
    matched: z.number().int(),
    limit: z.number().int(),
    sample: z.array(WorkflowEngineActionSampleJobDTO),
  })
  .openapi('WorkflowEngineActionPreview');
