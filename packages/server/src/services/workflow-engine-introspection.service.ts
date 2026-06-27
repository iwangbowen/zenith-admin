import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CronExpressionParser } from 'cron-parser';
import type {
  WorkflowEngineApdex,
  WorkflowEngineComponent,
  WorkflowEngineComponentStatus,
  WorkflowEngineDefinitionSnapshot,
  WorkflowEngineEventBucket,
  WorkflowEngineHistogramBucket,
  WorkflowEngineInstanceBucket,
  WorkflowEngineIntrospection,
  WorkflowEngineMetric,
  WorkflowEngineQueueKey,
  WorkflowEngineQueueSnapshot,
  WorkflowEngineRuntimeIssue,
  WorkflowEngineRuntimeTask,
  WorkflowEngineScoreFactor,
  WorkflowEngineTelemetry,
  WorkflowEngineThresholds,
  WorkflowEngineTriggerExecution,
  WorkflowEngineOutboxEvent,
  WorkflowFlowData,
  WorkflowInstancePriority,
} from '@zenith/shared';
import { db } from '../db';
import { workflowDefinitions, workflowEventOutbox, workflowInstances, workflowTasks, workflowTriggerExecutions, users } from '../db/schema';
import { currentUser } from '../lib/context';
import { getDataScopeCondition } from '../lib/data-scope';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import { getSchedulerIntrospection } from '../lib/pg-boss-scheduler';
import { getConfigNumber } from '../lib/system-config';
import { tenantCondition } from '../lib/tenant';
import { getWorkflowEventBusIntrospection } from '../lib/workflow-event-bus';
import { validateFlowData } from '../lib/workflow-engine';

type ComponentKey = WorkflowEngineComponent['key'];

const COMPONENT_LABELS: Record<ComponentKey, { name: string; description: string }> = {
  dagExecutor: {
    name: 'DAG 执行器',
    description: 'advanceFlow / getInitialTasks 的流程图遍历、网关分支和节点推进规则。',
  },
  taskMaterializer: {
    name: '任务物化器',
    description: '将引擎输出的 TaskAction 展开成 workflow_tasks 行，并处理审批人、超时、外部审批、触发器等运行态。',
  },
  delayScheduler: {
    name: '延时调度器',
    description: '基于 pg-boss 的 delay 节点唤醒队列与 DB 兜底恢复扫描。',
  },
  timeoutProcessor: {
    name: '超时处理器',
    description: '扫描 pending 且 timeoutAt 到期的审批任务，执行提醒、自动通过/拒绝或升级转交。',
  },
  triggerDispatcher: {
    name: '触发器调度器',
    description: '监听 node.entered，对 trigger 节点执行 webhook/callback/updateData/deleteData 副作用，并维护重试状态。',
  },
  externalApprover: {
    name: '外部审批分派',
    description: '监听 task.created，将外部审批任务分派给外部系统，并等待公开回调确认。',
  },
  subProcessRecovery: {
    name: '子流程恢复器',
    description: '扫描子流程 spawn / resume / 多实例汇聚中断场景，保证异步副作用最终收敛。',
  },
  eventBus: {
    name: '事件总线',
    description: '进程内工作流事件派发器，负责 node/task/instance 事件同步给内置订阅者。',
  },
  outbox: {
    name: '事件 Outbox',
    description: '持久化工作流事件，并通过周期性 replay 兜底重放失败事件。',
  },
  scheduler: {
    name: 'pg-boss 调度器',
    description: '承载用户 Cron、系统周期任务、延时唤醒队列和工作流恢复扫描。',
  },
};

function whereOrUndefined(conditions: SQL[]): SQL | undefined {
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function ageMinutes(value: Date | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
}

function isDateTimeDue(value: string | null | undefined, boundary: Date): boolean {
  const parsed = parseDateTimeInput(value);
  return parsed != null && parsed.getTime() <= boundary.getTime();
}

function worstStatus(statuses: WorkflowEngineComponentStatus[]): WorkflowEngineComponentStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

function metric(label: string, value: number | string, status?: WorkflowEngineComponentStatus, hint?: string | null, unit?: string | null): WorkflowEngineMetric {
  return { label, value, status: status ?? null, hint: hint ?? null, unit: unit ?? null };
}

function queueSnapshot(input: {
  key: WorkflowEngineQueueKey;
  name: string;
  ready?: number;
  running?: number;
  delayed?: number;
  failed?: number;
  oldestAgeMinutes?: number | null;
  details?: Record<string, number | string | null>;
}): WorkflowEngineQueueSnapshot {
  const ready = input.ready ?? 0;
  const running = input.running ?? 0;
  const delayed = input.delayed ?? 0;
  const failed = input.failed ?? 0;
  const stale = input.oldestAgeMinutes != null && input.oldestAgeMinutes >= 60;
  const status: WorkflowEngineComponentStatus = failed > 0 ? 'critical' : stale ? 'warning' : 'healthy';
  return {
    key: input.key,
    name: input.name,
    status,
    ready,
    running,
    delayed,
    failed,
    oldestAgeMinutes: input.oldestAgeMinutes ?? null,
    details: input.details ?? null,
  };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function validateDefinitions(rows: Array<typeof workflowDefinitions.$inferSelect>): WorkflowEngineDefinitionSnapshot {
  const nodeTypes: string[] = [];
  let edgeCount = 0;
  const invalidDefinitions: WorkflowEngineDefinitionSnapshot['invalidDefinitions'] = [];
  for (const row of rows) {
    const flowData = row.flowData as WorkflowFlowData | null;
    if (flowData?.nodes) {
      nodeTypes.push(...flowData.nodes.map((node) => node.data.type));
      edgeCount += Array.isArray(flowData.edges) ? flowData.edges.length : 0;
    }
    const validation = validateFlowData(flowData as WorkflowFlowData);
    if (!validation.valid) {
      invalidDefinitions.push({
        definitionId: row.id,
        name: row.name,
        status: row.status,
        version: row.version,
        errors: validation.errors,
      });
    }
  }
  return {
    total: rows.length,
    published: rows.filter((row) => row.status === 'published').length,
    invalid: invalidDefinitions.length,
    invalidPublished: invalidDefinitions.filter((row) => row.status === 'published').length,
    nodeTypeCounts: countBy(nodeTypes),
    edgeCount,
    invalidDefinitions: invalidDefinitions.slice(0, 50),
  };
}

function mapRuntimeTask(row: {
  queue: WorkflowEngineQueueKey;
  taskId: number;
  instanceId: number;
  instanceTitle: string;
  serialNo: string | null;
  definitionId: number;
  definitionName: string | null;
  nodeKey: string;
  nodeName: string;
  nodeType: typeof workflowTasks.$inferSelect['nodeType'];
  status: typeof workflowTasks.$inferSelect['status'];
  assigneeId: number | null;
  assigneeName: string | null;
  priority: string;
  externalCallbackId: string | null;
  externalDispatchStatus: typeof workflowTasks.$inferSelect['externalDispatchStatus'];
  triggerDispatchStatus: typeof workflowTasks.$inferSelect['triggerDispatchStatus'];
  triggerAttempt: number;
  triggerNextRetryAt: Date | null;
  triggerLastError: string | null;
  timeoutAt: Date | null;
  wakeAt: Date | null;
  createdAt: Date;
}, now: Date): WorkflowEngineRuntimeTask {
  return {
    queue: row.queue,
    taskId: row.taskId,
    instanceId: row.instanceId,
    instanceTitle: row.instanceTitle,
    serialNo: row.serialNo ?? null,
    definitionId: row.definitionId,
    definitionName: row.definitionName ?? '—',
    nodeKey: row.nodeKey,
    nodeName: row.nodeName,
    nodeType: row.nodeType ?? null,
    status: row.status,
    assigneeId: row.assigneeId ?? null,
    assigneeName: row.assigneeName ?? null,
    priority: (row.priority || 'normal') as WorkflowInstancePriority,
    externalCallbackId: row.externalCallbackId ?? null,
    externalDispatchStatus: row.externalDispatchStatus ?? null,
    triggerDispatchStatus: row.triggerDispatchStatus ?? null,
    triggerAttempt: row.triggerAttempt ?? 0,
    triggerNextRetryAt: formatNullableDateTime(row.triggerNextRetryAt),
    triggerLastError: row.triggerLastError ?? null,
    timeoutAt: formatNullableDateTime(row.timeoutAt),
    wakeAt: formatNullableDateTime(row.wakeAt),
    ageMinutes: ageMinutes(row.createdAt, now) ?? 0,
    createdAt: formatDateTime(row.createdAt),
  };
}

function mapTriggerExecution(row: typeof workflowTriggerExecutions.$inferSelect & { instanceTitle?: string | null }): WorkflowEngineTriggerExecution {
  return {
    id: row.id,
    instanceId: row.instanceId,
    taskId: row.taskId ?? null,
    nodeKey: row.nodeKey,
    nodeName: row.nodeName ?? null,
    triggerType: row.triggerType as WorkflowEngineTriggerExecution['triggerType'],
    status: row.status,
    attempt: row.attempt,
    requestUrl: row.requestUrl ?? null,
    requestMethod: row.requestMethod ?? null,
    requestBody: row.requestBody ?? null,
    responseStatus: row.responseStatus ?? null,
    responseBody: row.responseBody ?? null,
    errorMessage: row.errorMessage ?? null,
    durationMs: row.durationMs ?? null,
    tenantId: row.tenantId ?? null,
    createdAt: formatDateTime(row.createdAt),
    instanceTitle: row.instanceTitle ?? null,
  };
}

function mapOutboxEvent(row: typeof workflowEventOutbox.$inferSelect & { instanceTitle?: string | null }, now: Date): WorkflowEngineOutboxEvent {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    instanceId: row.instanceId ?? null,
    instanceTitle: row.instanceTitle ?? null,
    taskId: row.taskId ?? null,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.errorMessage ?? null,
    nextRetryAt: formatNullableDateTime(row.nextRetryAt),
    processedAt: formatNullableDateTime(row.processedAt),
    ageMinutes: ageMinutes(row.createdAt, now) ?? 0,
    createdAt: formatDateTime(row.createdAt),
  };
}

function buildIssues(input: {
  definitions: WorkflowEngineDefinitionSnapshot;
  runningWithoutActiveTasks: WorkflowEngineIntrospection['runtime']['runningWithoutActiveTasks'];
  runtimeTasks: WorkflowEngineRuntimeTask[];
  triggerExecutions: WorkflowEngineTriggerExecution[];
  outboxEvents: WorkflowEngineOutboxEvent[];
  eventBusListeners: number;
  schedulerInitialized: boolean;
}): WorkflowEngineRuntimeIssue[] {
  const issues: WorkflowEngineRuntimeIssue[] = [];
  for (const def of input.definitions.invalidDefinitions.filter((item) => item.status === 'published')) {
    issues.push({
      id: `definition:${def.definitionId}`,
      severity: 'critical',
      component: 'dagExecutor',
      title: '已发布流程定义未通过当前引擎校验',
      description: def.errors[0] ?? '流程图结构不合法。',
      refType: 'definition',
      refId: def.definitionId,
      metadata: { errors: def.errors, version: def.version },
    });
  }
  for (const inst of input.runningWithoutActiveTasks) {
    issues.push({
      id: `instance:${inst.instanceId}:no-active-task`,
      severity: 'critical',
      component: 'taskMaterializer',
      title: '运行中实例没有活动任务',
      description: `实例「${inst.title}」状态为 running，但没有 pending / waiting 任务，可能是推进结果未物化或状态回写中断。`,
      refType: 'instance',
      refId: inst.instanceId,
      ageMinutes: inst.ageMinutes,
      createdAt: inst.createdAt,
    });
  }
  for (const task of input.runtimeTasks) {
    if (task.queue === 'timeouts' && task.timeoutAt) {
      issues.push({
        id: `task:${task.taskId}:timeout-due`,
        severity: 'warning',
        component: 'timeoutProcessor',
        title: '任务超时待处理',
        description: `任务 #${task.taskId} 已到 timeoutAt，等待超时处理器扫描执行。`,
        refType: 'task',
        refId: task.taskId,
        ageMinutes: task.ageMinutes,
        createdAt: task.createdAt,
      });
    }
    if (task.queue === 'delayWakeups' && task.wakeAt) {
      issues.push({
        id: `task:${task.taskId}:delay-due`,
        severity: 'warning',
        component: 'delayScheduler',
        title: '延时节点已到期仍在等待',
        description: `delay 任务 #${task.taskId} 已到 wakeAt，可能等待 pg-boss 唤醒或兜底恢复扫描。`,
        refType: 'task',
        refId: task.taskId,
        ageMinutes: task.ageMinutes,
        createdAt: task.createdAt,
      });
    }
    if (task.queue === 'triggerDispatch' && task.triggerDispatchStatus === 'failed') {
      issues.push({
        id: `task:${task.taskId}:trigger-failed`,
        severity: 'critical',
        component: 'triggerDispatcher',
        title: '触发器任务调度失败',
        description: task.triggerLastError ?? `trigger 任务 #${task.taskId} 当前状态 failed。`,
        refType: 'task',
        refId: task.taskId,
        ageMinutes: task.ageMinutes,
        createdAt: task.createdAt,
      });
    }
    if (task.queue === 'externalApprovals' && task.externalDispatchStatus === 'failed') {
      issues.push({
        id: `task:${task.taskId}:external-failed`,
        severity: 'critical',
        component: 'externalApprover',
        title: '外部审批分派失败',
        description: `外部审批任务 #${task.taskId} 分派失败，需检查节点 externalApproval 配置或外部服务。`,
        refType: 'task',
        refId: task.taskId,
        ageMinutes: task.ageMinutes,
        createdAt: task.createdAt,
      });
    }
  }
  for (const execution of input.triggerExecutions.filter((item) => item.status === 'failed')) {
    issues.push({
      id: `trigger-execution:${execution.id}`,
      severity: 'critical',
      component: 'triggerDispatcher',
      title: '触发器执行记录失败',
      description: execution.errorMessage ?? `触发器执行 #${execution.id} 失败。`,
      refType: 'triggerExecution',
      refId: execution.id,
      createdAt: execution.createdAt,
    });
  }
  for (const event of input.outboxEvents.filter((item) => item.status === 'failed')) {
    issues.push({
      id: `outbox:${event.id}`,
      severity: 'critical',
      component: 'outbox',
      title: '事件 Outbox 重放失败',
      description: event.errorMessage ?? `事件 ${event.eventType} 重放失败。`,
      refType: 'outbox',
      refId: event.id,
      ageMinutes: event.ageMinutes,
      createdAt: event.createdAt,
    });
  }
  if (!input.schedulerInitialized) {
    issues.push({
      id: 'scheduler:not-initialized',
      severity: 'critical',
      component: 'scheduler',
      title: 'pg-boss 调度器未初始化',
      description: '系统周期任务、延时唤醒和恢复扫描依赖 pg-boss；未初始化会导致内部队列停摆。',
      refType: 'scheduler',
    });
  }
  if (input.eventBusListeners === 0) {
    issues.push({
      id: 'event-bus:no-listener',
      severity: 'critical',
      component: 'eventBus',
      title: '事件总线没有注册监听器',
      description: '工作流事件无法同步给通知、触发器、外部审批、自动化等内置订阅者。',
      refType: 'scheduler',
    });
  }
  return issues.slice(0, 100);
}

function component(key: ComponentKey, status: WorkflowEngineComponentStatus, metrics: WorkflowEngineMetric[], internals?: Record<string, unknown>): WorkflowEngineComponent {
  const meta = COMPONENT_LABELS[key];
  return {
    key,
    name: meta.name,
    description: meta.description,
    status,
    metrics,
    internals: internals ?? null,
  };
}

const SCHEDULER_TZ = 'Asia/Shanghai';

function nextCronRun(cron: string, from: Date): string | null {
  try {
    return formatDateTime(CronExpressionParser.parse(cron.trim(), { currentDate: from, tz: SCHEDULER_TZ }).next().toDate());
  } catch {
    return null;
  }
}

/**
 * 引擎健康分 0-100：以 100 为基准，按运行时问题严重程度与队列饱和/陈旧度扣分。
 * 返回最终分值与扣分归因（让健康分可解释），用于顶部 Stat 面板 + 解释 tooltip。
 */
function computeHealthScore(
  issues: WorkflowEngineRuntimeIssue[],
  queues: WorkflowEngineQueueSnapshot[],
): { score: number; breakdown: WorkflowEngineScoreFactor[] } {
  let score = 100;
  const breakdown: WorkflowEngineScoreFactor[] = [];
  const criticalIssues = issues.filter((i) => i.severity === 'critical').length;
  const warningIssues = issues.filter((i) => i.severity === 'warning').length;
  if (criticalIssues > 0) {
    const delta = criticalIssues * 12;
    score -= delta;
    breakdown.push({ reason: `严重问题 ×${criticalIssues}`, delta, severity: 'critical' });
  }
  if (warningIssues > 0) {
    const delta = warningIssues * 4;
    score -= delta;
    breakdown.push({ reason: `警告问题 ×${warningIssues}`, delta, severity: 'warning' });
  }
  const failedQueues = queues.filter((q) => q.failed > 0).length;
  if (failedQueues > 0) {
    const delta = failedQueues * 5;
    score -= delta;
    breakdown.push({ reason: `队列存在失败任务 ×${failedQueues}`, delta, severity: 'critical' });
  }
  const staleQueues = queues.filter((q) => q.oldestAgeMinutes != null && q.oldestAgeMinutes >= 60).length;
  if (staleQueues > 0) {
    const delta = staleQueues * 3;
    score -= delta;
    breakdown.push({ reason: `队列积压≥60 分钟 ×${staleQueues}`, delta, severity: 'warning' });
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), breakdown };
}

const THRESHOLD_DEFAULTS = {
  healthWarn: 90,
  healthCritical: 70,
  backlogWarn: 50,
  backlogCritical: 200,
  errorRateWarn: 0.05,
  errorRateCritical: 0.15,
  apdexThresholdMs: 100,
} as const;

const THRESHOLD_CONFIG_KEYS = {
  healthWarn: 'workflow_engine_health_warn',
  healthCritical: 'workflow_engine_health_critical',
  backlogWarn: 'workflow_engine_backlog_warn',
  backlogCritical: 'workflow_engine_backlog_critical',
  errorRateWarn: 'workflow_engine_error_rate_warn',
  errorRateCritical: 'workflow_engine_error_rate_critical',
  apdexThresholdMs: 'workflow_engine_apdex_threshold_ms',
} as const;

/** 读取可配置阈值（system_configs），缺省回退到内置默认。 */
export async function getWorkflowEngineThresholds(): Promise<WorkflowEngineThresholds & { apdexThresholdMs: number }> {
  const [healthWarn, healthCritical, backlogWarn, backlogCritical, errorRateWarn, errorRateCritical, apdexThresholdMs] = await Promise.all([
    getConfigNumber(THRESHOLD_CONFIG_KEYS.healthWarn, THRESHOLD_DEFAULTS.healthWarn),
    getConfigNumber(THRESHOLD_CONFIG_KEYS.healthCritical, THRESHOLD_DEFAULTS.healthCritical),
    getConfigNumber(THRESHOLD_CONFIG_KEYS.backlogWarn, THRESHOLD_DEFAULTS.backlogWarn),
    getConfigNumber(THRESHOLD_CONFIG_KEYS.backlogCritical, THRESHOLD_DEFAULTS.backlogCritical),
    getConfigNumber(THRESHOLD_CONFIG_KEYS.errorRateWarn, THRESHOLD_DEFAULTS.errorRateWarn),
    getConfigNumber(THRESHOLD_CONFIG_KEYS.errorRateCritical, THRESHOLD_DEFAULTS.errorRateCritical),
    getConfigNumber(THRESHOLD_CONFIG_KEYS.apdexThresholdMs, THRESHOLD_DEFAULTS.apdexThresholdMs),
  ]);
  return { healthWarn, healthCritical, backlogWarn, backlogCritical, errorRateWarn, errorRateCritical, apdexThresholdMs };
}

/** 综合严重级别：按健康分档位映射（健康分已综合 issue/queue 扣分）。 */
export function severityFromHealth(score: number, thresholds: WorkflowEngineThresholds): WorkflowEngineComponentStatus {
  if (score >= thresholds.healthWarn) return 'healthy';
  if (score >= thresholds.healthCritical) return 'warning';
  return 'critical';
}

const LATENCY_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: '<50ms', min: 0, max: 50 },
  { label: '50-100ms', min: 50, max: 100 },
  { label: '100-250ms', min: 100, max: 250 },
  { label: '250-500ms', min: 250, max: 500 },
  { label: '500ms-1s', min: 500, max: 1000 },
  { label: '1-5s', min: 1000, max: 5000 },
  { label: '≥5s', min: 5000, max: null },
];

/** 将 7 个桶计数数组映射为直方图结构。 */
function buildHistogram(counts: number[]): WorkflowEngineHistogramBucket[] {
  return LATENCY_BUCKETS.map((b, i) => ({ label: b.label, min: b.min, max: b.max, count: counts[i] ?? 0 }));
}

/** 由满意/容忍/沮丧计数计算 Apdex。 */
function buildApdex(satisfied: number, tolerating: number, frustrated: number, thresholdMs: number): WorkflowEngineApdex {
  const total = satisfied + tolerating + frustrated;
  const score = total > 0 ? (satisfied + tolerating / 2) / total : null;
  return { score: score != null ? Math.round(score * 1000) / 1000 : null, thresholdMs, satisfied, tolerating, frustrated, total };
}

const HOUR_MS = 60 * 60 * 1000;
const SERIES_HOURS = 24;
/** 单次内省拉取的时序明细行上限（manual 刷新的诊断端点，体量可控） */
const SERIES_ROW_LIMIT = 20000;

/** 生成对齐到整点的近 N 小时桶（含当前小时），桶时间用 formatDateTime 统一格式输出。 */
function makeHourSlots(now: Date, count = SERIES_HOURS): Array<{ start: number; hour: string }> {
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const slots: Array<{ start: number; hour: string }> = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = currentHour - i * HOUR_MS;
    slots.push({ start, hour: formatDateTime(new Date(start)) });
  }
  return slots;
}

function slotIndexOf(value: Date | null | undefined, firstStart: number): number {
  if (!value) return -1;
  return Math.floor((value.getTime() - firstStart) / HOUR_MS);
}

function buildEventSeries(rows: Array<{ createdAt: Date; status: string }>, now: Date): WorkflowEngineEventBucket[] {
  const slots = makeHourSlots(now);
  const firstStart = slots[0]?.start ?? now.getTime();
  const out = slots.map((slot) => ({ hour: slot.hour, total: 0, success: 0, failed: 0 }));
  for (const row of rows) {
    const idx = slotIndexOf(row.createdAt, firstStart);
    if (idx < 0 || idx >= out.length) continue;
    out[idx].total += 1;
    if (row.status === 'success') out[idx].success += 1;
    else if (row.status === 'failed') out[idx].failed += 1;
  }
  return out;
}

function buildInstanceSeries(
  rows: Array<{ createdAt: Date; updatedAt: Date; status: string }>,
  now: Date,
  terminalStatuses: readonly string[],
): WorkflowEngineInstanceBucket[] {
  const slots = makeHourSlots(now);
  const firstStart = slots[0]?.start ?? now.getTime();
  const out = slots.map((slot) => ({ hour: slot.hour, created: 0, completed: 0 }));
  const terminal = new Set(terminalStatuses);
  for (const row of rows) {
    const createdIdx = slotIndexOf(row.createdAt, firstStart);
    if (createdIdx >= 0 && createdIdx < out.length) out[createdIdx].created += 1;
    if (terminal.has(row.status)) {
      const completedIdx = slotIndexOf(row.updatedAt, firstStart);
      if (completedIdx >= 0 && completedIdx < out.length) out[completedIdx].completed += 1;
    }
  }
  return out;
}

export async function getWorkflowEngineIntrospection(
  thresholdMinutes = 30,
  options: { systemWide?: boolean } = {},
): Promise<WorkflowEngineIntrospection> {
  const now = new Date();
  const threshold = Math.max(1, Math.min(thresholdMinutes, 24 * 60));
  const dueSoon = new Date(now.getTime() + 24 * 60 * 60_000);
  // systemWide：定时采集等无请求上下文场景，平台级统计，跳过租户/数据权限过滤。
  const systemWide = options.systemWide === true;
  const user = systemWide ? null : currentUser();
  const assigneeUsers = alias(users, 'workflow_engine_task_assignee');
  const instTenant = user ? tenantCondition(workflowInstances, user) : undefined;
  const defTenant = user ? tenantCondition(workflowDefinitions, user) : undefined;
  const outboxTenant = user ? tenantCondition(workflowEventOutbox, user) : undefined;
  const taskScope = user
    ? await getDataScopeCondition({
        currentUserId: user.userId,
        deptColumn: users.departmentId,
        ownerColumn: workflowInstances.initiatorId,
      })
    : undefined;

  const instanceBaseConds: SQL[] = [];
  if (instTenant) instanceBaseConds.push(instTenant);
  if (taskScope) instanceBaseConds.push(taskScope);
  const instanceBaseWhere = whereOrUndefined(instanceBaseConds);

  const taskBaseConds: SQL[] = [eq(workflowInstances.status, 'running')];
  if (instTenant) taskBaseConds.push(instTenant);
  if (taskScope) taskBaseConds.push(taskScope);

  const since1h = new Date(now.getTime() - 60 * 60_000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
  const since48h = new Date(now.getTime() - 48 * 60 * 60_000);
  const thresholds = await getWorkflowEngineThresholds();
  const apdexT = thresholds.apdexThresholdMs;
  // 事件处理延迟（毫秒）SQL 片段 + 「近 24h 成功且已处理」过滤片段，复用于 P95/P99/直方图/Apdex。
  const evLatency = sql`extract(epoch from (${workflowEventOutbox.processedAt} - ${workflowEventOutbox.createdAt})) * 1000`;
  const evDone24h = and(eq(workflowEventOutbox.status, 'success'), isNotNull(workflowEventOutbox.processedAt), gte(workflowEventOutbox.createdAt, since24h));
  const trDone24h = and(eq(workflowTriggerExecutions.status, 'success'), isNotNull(workflowTriggerExecutions.durationMs), gte(workflowTriggerExecutions.createdAt, since24h));
  const trDuration = sql`${workflowTriggerExecutions.durationMs}`;
  const terminalStatuses = ['approved', 'rejected', 'withdrawn', 'cancelled'] as const;
  const canceledStatuses = ['withdrawn', 'cancelled'] as const;
  const outboxScopeConds: SQL[] = [];
  if (outboxTenant) outboxScopeConds.push(outboxTenant);
  outboxScopeConds.push(or(isNull(workflowEventOutbox.instanceId), instanceBaseWhere ?? sql`true`)!);
  const triggerScopeConds: SQL[] = [];
  if (instTenant) triggerScopeConds.push(instTenant);
  if (taskScope) triggerScopeConds.push(taskScope);

  const [definitions, runningInstanceRows, activeInstanceRows, runtimeTaskRows, triggerRows, outboxRows, eventStatsRows, triggerStatsRows, instanceStatsRows, eventSeriesRows, instanceSeriesRows] = await Promise.all([
    db.select().from(workflowDefinitions).where(defTenant),
    db.select({
      instanceId: workflowInstances.id,
      title: workflowInstances.title,
      serialNo: workflowInstances.serialNo,
      definitionId: workflowInstances.definitionId,
      definitionName: workflowDefinitions.name,
      currentNodeKey: workflowInstances.currentNodeKey,
      createdAt: workflowInstances.createdAt,
    })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(and(...instanceBaseConds, eq(workflowInstances.status, 'running'))),
    db.select({ instanceId: workflowTasks.instanceId })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(and(...taskBaseConds, inArray(workflowTasks.status, ['pending', 'waiting']))),
    db.select({
      taskId: workflowTasks.id,
      instanceId: workflowTasks.instanceId,
      instanceTitle: workflowInstances.title,
      serialNo: workflowInstances.serialNo,
      definitionId: workflowInstances.definitionId,
      definitionName: workflowDefinitions.name,
      nodeKey: workflowTasks.nodeKey,
      nodeName: workflowTasks.nodeName,
      nodeType: workflowTasks.nodeType,
      status: workflowTasks.status,
      assigneeId: workflowTasks.assigneeId,
      assigneeName: assigneeUsers.nickname,
      priority: workflowInstances.priority,
      externalCallbackId: workflowTasks.externalCallbackId,
      externalDispatchStatus: workflowTasks.externalDispatchStatus,
      triggerDispatchStatus: workflowTasks.triggerDispatchStatus,
      triggerAttempt: workflowTasks.triggerAttempt,
      triggerNextRetryAt: workflowTasks.triggerNextRetryAt,
      triggerLastError: workflowTasks.triggerLastError,
      timeoutAt: workflowTasks.timeoutAt,
      wakeAt: workflowTasks.wakeAt,
      createdAt: workflowTasks.createdAt,
    })
      .from(workflowTasks)
      .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .leftJoin(assigneeUsers, eq(workflowTasks.assigneeId, assigneeUsers.id))
      .where(and(
        ...taskBaseConds,
        or(
          eq(workflowTasks.status, 'pending'),
          eq(workflowTasks.status, 'waiting'),
          eq(workflowTasks.externalDispatchStatus, 'failed'),
          eq(workflowTasks.triggerDispatchStatus, 'failed'),
          eq(workflowTasks.triggerDispatchStatus, 'retrying'),
        )!,
      ))
      .orderBy(asc(workflowTasks.createdAt))
      .limit(300),
    db.select({ row: workflowTriggerExecutions, instanceTitle: workflowInstances.title })
      .from(workflowTriggerExecutions)
      .innerJoin(workflowInstances, eq(workflowTriggerExecutions.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined([
        ...(instTenant ? [instTenant] : []),
        ...(taskScope ? [taskScope] : []),
        notInArray(workflowTriggerExecutions.status, ['success']),
      ]))
      .orderBy(desc(workflowTriggerExecutions.id))
      .limit(100),
    db.select({ row: workflowEventOutbox, instanceTitle: workflowInstances.title })
      .from(workflowEventOutbox)
      .leftJoin(workflowInstances, eq(workflowEventOutbox.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined([
        ...(outboxTenant ? [outboxTenant] : []),
        or(isNull(workflowEventOutbox.instanceId), instanceBaseWhere ?? sql`true`)!,
        notInArray(workflowEventOutbox.status, ['success']),
      ]))
      .orderBy(desc(workflowEventOutbox.id))
      .limit(100),
    db.select({
      total1h: sql<number>`count(*) filter (where ${gte(workflowEventOutbox.createdAt, since1h)})`.mapWith(Number),
      success1h: sql<number>`count(*) filter (where ${and(eq(workflowEventOutbox.status, 'success'), gte(workflowEventOutbox.createdAt, since1h))})`.mapWith(Number),
      failed1h: sql<number>`count(*) filter (where ${and(eq(workflowEventOutbox.status, 'failed'), gte(workflowEventOutbox.createdAt, since1h))})`.mapWith(Number),
      total24h: sql<number>`count(*) filter (where ${gte(workflowEventOutbox.createdAt, since24h)})`.mapWith(Number),
      success24h: sql<number>`count(*) filter (where ${and(eq(workflowEventOutbox.status, 'success'), gte(workflowEventOutbox.createdAt, since24h))})`.mapWith(Number),
      failed24h: sql<number>`count(*) filter (where ${and(eq(workflowEventOutbox.status, 'failed'), gte(workflowEventOutbox.createdAt, since24h))})`.mapWith(Number),
      totalPrev24h: sql<number>`count(*) filter (where ${and(gte(workflowEventOutbox.createdAt, since48h), lt(workflowEventOutbox.createdAt, since24h))})`.mapWith(Number),
      successPrev24h: sql<number>`count(*) filter (where ${and(eq(workflowEventOutbox.status, 'success'), gte(workflowEventOutbox.createdAt, since48h), lt(workflowEventOutbox.createdAt, since24h))})`.mapWith(Number),
      failedPrev24h: sql<number>`count(*) filter (where ${and(eq(workflowEventOutbox.status, 'failed'), gte(workflowEventOutbox.createdAt, since48h), lt(workflowEventOutbox.createdAt, since24h))})`.mapWith(Number),
      pendingRetry: sql<number>`count(*) filter (where ${inArray(workflowEventOutbox.status, ['pending', 'processing', 'retrying'])})`.mapWith(Number),
      avgLatencyMs: sql<number | null>`avg(${evLatency}) filter (where ${evDone24h})`.mapWith(Number),
      p95LatencyMs: sql<number | null>`percentile_cont(0.95) within group (order by ${evLatency}) filter (where ${evDone24h})`.mapWith(Number),
      p99LatencyMs: sql<number | null>`percentile_cont(0.99) within group (order by ${evLatency}) filter (where ${evDone24h})`.mapWith(Number),
      h0: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} < 50)`.mapWith(Number),
      h1: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} >= 50 and ${evLatency} < 100)`.mapWith(Number),
      h2: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} >= 100 and ${evLatency} < 250)`.mapWith(Number),
      h3: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} >= 250 and ${evLatency} < 500)`.mapWith(Number),
      h4: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} >= 500 and ${evLatency} < 1000)`.mapWith(Number),
      h5: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} >= 1000 and ${evLatency} < 5000)`.mapWith(Number),
      h6: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} >= 5000)`.mapWith(Number),
      apdexSatisfied: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} <= ${apdexT})`.mapWith(Number),
      apdexTolerating: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} > ${apdexT} and ${evLatency} <= ${apdexT * 4})`.mapWith(Number),
      apdexFrustrated: sql<number>`count(*) filter (where ${evDone24h} and ${evLatency} > ${apdexT * 4})`.mapWith(Number),
    })
      .from(workflowEventOutbox)
      .leftJoin(workflowInstances, eq(workflowEventOutbox.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined(outboxScopeConds)),
    db.select({
      total24h: sql<number>`count(*) filter (where ${gte(workflowTriggerExecutions.createdAt, since24h)})`.mapWith(Number),
      success24h: sql<number>`count(*) filter (where ${and(eq(workflowTriggerExecutions.status, 'success'), gte(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      failed24h: sql<number>`count(*) filter (where ${and(eq(workflowTriggerExecutions.status, 'failed'), gte(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      retrying24h: sql<number>`count(*) filter (where ${and(eq(workflowTriggerExecutions.status, 'retrying'), gte(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      totalPrev24h: sql<number>`count(*) filter (where ${and(gte(workflowTriggerExecutions.createdAt, since48h), lt(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      successPrev24h: sql<number>`count(*) filter (where ${and(eq(workflowTriggerExecutions.status, 'success'), gte(workflowTriggerExecutions.createdAt, since48h), lt(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      failedPrev24h: sql<number>`count(*) filter (where ${and(eq(workflowTriggerExecutions.status, 'failed'), gte(workflowTriggerExecutions.createdAt, since48h), lt(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      retryingPrev24h: sql<number>`count(*) filter (where ${and(eq(workflowTriggerExecutions.status, 'retrying'), gte(workflowTriggerExecutions.createdAt, since48h), lt(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
      avgDurationMs: sql<number | null>`avg(${trDuration}) filter (where ${trDone24h})`.mapWith(Number),
      p95DurationMs: sql<number | null>`percentile_cont(0.95) within group (order by ${trDuration}) filter (where ${trDone24h})`.mapWith(Number),
      p99DurationMs: sql<number | null>`percentile_cont(0.99) within group (order by ${trDuration}) filter (where ${trDone24h})`.mapWith(Number),
      th0: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} < 50)`.mapWith(Number),
      th1: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} >= 50 and ${trDuration} < 100)`.mapWith(Number),
      th2: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} >= 100 and ${trDuration} < 250)`.mapWith(Number),
      th3: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} >= 250 and ${trDuration} < 500)`.mapWith(Number),
      th4: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} >= 500 and ${trDuration} < 1000)`.mapWith(Number),
      th5: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} >= 1000 and ${trDuration} < 5000)`.mapWith(Number),
      th6: sql<number>`count(*) filter (where ${trDone24h} and ${trDuration} >= 5000)`.mapWith(Number),
    })
      .from(workflowTriggerExecutions)
      .innerJoin(workflowInstances, eq(workflowTriggerExecutions.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined(triggerScopeConds)),
    db.select({
      createdLast24h: sql<number>`count(*) filter (where ${gte(workflowInstances.createdAt, since24h)})`.mapWith(Number),
      completedLast24h: sql<number>`count(*) filter (where ${and(inArray(workflowInstances.status, [...terminalStatuses]), gte(workflowInstances.updatedAt, since24h))})`.mapWith(Number),
      canceledLast24h: sql<number>`count(*) filter (where ${and(inArray(workflowInstances.status, [...canceledStatuses]), gte(workflowInstances.updatedAt, since24h))})`.mapWith(Number),
      createdPrev24h: sql<number>`count(*) filter (where ${and(gte(workflowInstances.createdAt, since48h), lt(workflowInstances.createdAt, since24h))})`.mapWith(Number),
      completedPrev24h: sql<number>`count(*) filter (where ${and(inArray(workflowInstances.status, [...terminalStatuses]), gte(workflowInstances.updatedAt, since48h), lt(workflowInstances.updatedAt, since24h))})`.mapWith(Number),
    })
      .from(workflowInstances)
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(instanceBaseWhere),
    db.select({ createdAt: workflowEventOutbox.createdAt, status: workflowEventOutbox.status })
      .from(workflowEventOutbox)
      .leftJoin(workflowInstances, eq(workflowEventOutbox.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined([...outboxScopeConds, gte(workflowEventOutbox.createdAt, since24h)]))
      .limit(SERIES_ROW_LIMIT),
    db.select({ createdAt: workflowInstances.createdAt, updatedAt: workflowInstances.updatedAt, status: workflowInstances.status })
      .from(workflowInstances)
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined([
        ...instanceBaseConds,
        or(
          gte(workflowInstances.createdAt, since24h),
          and(inArray(workflowInstances.status, [...terminalStatuses]), gte(workflowInstances.updatedAt, since24h)),
        )!,
      ]))
      .limit(SERIES_ROW_LIMIT),
  ]);

  const definitionsSnapshot = validateDefinitions(definitions);
  const activeInstanceIds = new Set(activeInstanceRows.map((row) => row.instanceId));
  const runningWithoutActiveTasks = runningInstanceRows
    .filter((row) => !activeInstanceIds.has(row.instanceId))
    .map((row) => ({
      instanceId: row.instanceId,
      title: row.title,
      serialNo: row.serialNo ?? null,
      definitionId: row.definitionId,
      definitionName: row.definitionName ?? null,
      currentNodeKey: row.currentNodeKey ?? null,
      ageMinutes: ageMinutes(row.createdAt, now) ?? 0,
      createdAt: formatDateTime(row.createdAt),
    }))
    .slice(0, 50);

  const runtimeTasks: WorkflowEngineRuntimeTask[] = runtimeTaskRows.flatMap((row) => {
    const queues: WorkflowEngineQueueKey[] = [];
    if (row.status === 'pending' && row.nodeType !== 'trigger') queues.push('humanTasks');
    if (row.nodeType === 'delay' && row.status === 'waiting') queues.push('delayWakeups');
    if (row.status === 'pending' && row.timeoutAt && row.timeoutAt <= now) queues.push('timeouts');
    if (row.nodeType === 'trigger') queues.push('triggerDispatch');
    if (row.externalCallbackId || row.externalDispatchStatus) queues.push('externalApprovals');
    if (row.nodeType === 'subProcess' && row.status === 'waiting') queues.push('subProcessJoin');
    return queues.map((queue) => mapRuntimeTask({ ...row, queue }, now));
  });
  const triggerExecutions = triggerRows.map(({ row, instanceTitle }) => mapTriggerExecution({ ...row, instanceTitle }));
  const outboxEvents = outboxRows.map(({ row, instanceTitle }) => mapOutboxEvent({ ...row, instanceTitle }, now));
  const eventBus = getWorkflowEventBusIntrospection();
  const scheduler = getSchedulerIntrospection();

  const pendingTasks = runtimeTasks.filter((task) => task.queue === 'humanTasks');
  const delayTasks = runtimeTasks.filter((task) => task.queue === 'delayWakeups');
  const overdueDelayTasks = delayTasks.filter((task) => isDateTimeDue(task.wakeAt, now));
  const timeoutTasks = runtimeTasks.filter((task) => task.queue === 'timeouts');
  const triggerTasks = runtimeTasks.filter((task) => task.queue === 'triggerDispatch');
  const externalTasks = runtimeTasks.filter((task) => task.queue === 'externalApprovals');
  const subProcessTasks = runtimeTasks.filter((task) => task.queue === 'subProcessJoin');
  const pendingOutbox = outboxEvents.filter((event) => event.status === 'pending');
  const retryingOutbox = outboxEvents.filter((event) => event.status === 'retrying' || event.status === 'processing');
  const failedOutbox = outboxEvents.filter((event) => event.status === 'failed');

  const queues = [
    queueSnapshot({
      key: 'humanTasks',
      name: '人工任务队列',
      ready: pendingTasks.length,
      oldestAgeMinutes: pendingTasks.length ? Math.max(...pendingTasks.map((task) => task.ageMinutes)) : null,
      details: {
        dueSoon: runtimeTasks.filter((task) => task.queue === 'humanTasks' && isDateTimeDue(task.timeoutAt, dueSoon)).length,
      },
    }),
    queueSnapshot({
      key: 'delayWakeups',
      name: '延时唤醒队列',
      delayed: Math.max(0, delayTasks.length - overdueDelayTasks.length),
      ready: overdueDelayTasks.length,
      oldestAgeMinutes: overdueDelayTasks.length ? Math.max(...overdueDelayTasks.map((task) => task.ageMinutes)) : null,
    }),
    queueSnapshot({
      key: 'timeouts',
      name: '超时处理队列',
      ready: timeoutTasks.length,
      oldestAgeMinutes: timeoutTasks.length ? Math.max(...timeoutTasks.map((task) => task.ageMinutes)) : null,
    }),
    queueSnapshot({
      key: 'triggerDispatch',
      name: '触发器调度队列',
      ready: triggerTasks.filter((task) => task.triggerDispatchStatus === null || task.triggerDispatchStatus === 'pending').length,
      running: triggerTasks.filter((task) => task.triggerDispatchStatus === 'running').length,
      delayed: triggerTasks.filter((task) => task.triggerDispatchStatus === 'retrying').length,
      failed: triggerTasks.filter((task) => task.triggerDispatchStatus === 'failed').length,
      oldestAgeMinutes: triggerTasks.length ? Math.max(...triggerTasks.map((task) => task.ageMinutes)) : null,
    }),
    queueSnapshot({
      key: 'externalApprovals',
      name: '外部审批分派队列',
      ready: externalTasks.filter((task) => task.externalDispatchStatus === 'pending').length,
      running: externalTasks.filter((task) => task.externalDispatchStatus === 'dispatched').length,
      failed: externalTasks.filter((task) => task.externalDispatchStatus === 'failed' || task.externalDispatchStatus === 'fallback').length,
      oldestAgeMinutes: externalTasks.length ? Math.max(...externalTasks.map((task) => task.ageMinutes)) : null,
    }),
    queueSnapshot({
      key: 'subProcessJoin',
      name: '子流程汇聚队列',
      ready: subProcessTasks.length,
      oldestAgeMinutes: subProcessTasks.length ? Math.max(...subProcessTasks.map((task) => task.ageMinutes)) : null,
    }),
    queueSnapshot({
      key: 'eventOutbox',
      name: '工作流事件 Outbox',
      ready: pendingOutbox.length,
      delayed: retryingOutbox.length,
      failed: failedOutbox.length,
      oldestAgeMinutes: outboxEvents.length ? Math.max(...outboxEvents.map((event) => event.ageMinutes)) : null,
    }),
  ];

  const issues = buildIssues({
    definitions: definitionsSnapshot,
    runningWithoutActiveTasks,
    runtimeTasks,
    triggerExecutions,
    outboxEvents,
    eventBusListeners: eventBus.totalListenerCount,
    schedulerInitialized: scheduler.initialized,
  });

  const componentStatusByIssue = (key: ComponentKey): WorkflowEngineComponentStatus => worstStatus(issues.filter((issue) => issue.component === key).map((issue) => issue.severity === 'info' ? 'healthy' : issue.severity));
  const queueStatus = (key: WorkflowEngineQueueKey) => queues.find((queue) => queue.key === key)?.status ?? 'healthy';

  const components: WorkflowEngineComponent[] = [
    component('dagExecutor', componentStatusByIssue('dagExecutor'), [
      metric('定义总数', definitionsSnapshot.total),
      metric('已发布', definitionsSnapshot.published),
      metric('校验失败', definitionsSnapshot.invalid, definitionsSnapshot.invalidPublished > 0 ? 'critical' : definitionsSnapshot.invalid > 0 ? 'warning' : 'healthy'),
      metric('节点数', Object.values(definitionsSnapshot.nodeTypeCounts).reduce((sum, value) => sum + value, 0)),
      metric('连线数', definitionsSnapshot.edgeCount),
    ], { nodeTypeCounts: definitionsSnapshot.nodeTypeCounts }),
    component('taskMaterializer', componentStatusByIssue('taskMaterializer'), [
      metric('运行实例', runningInstanceRows.length),
      metric('无活动任务实例', runningWithoutActiveTasks.length, runningWithoutActiveTasks.length > 0 ? 'critical' : 'healthy'),
      metric('活动任务', activeInstanceRows.length),
    ]),
    component('delayScheduler', worstStatus([queueStatus('delayWakeups'), scheduler.systemQueueWorkers.some((item) => item.name === 'workflow-delay-wakeup') ? 'healthy' : 'warning']), [
      metric('等待唤醒', delayTasks.length),
      metric('已到期', overdueDelayTasks.length, overdueDelayTasks.length > 0 ? 'warning' : 'healthy'),
      metric('队列 worker', scheduler.systemQueueWorkers.some((item) => item.name === 'workflow-delay-wakeup') ? '已注册' : '未注册', scheduler.systemQueueWorkers.some((item) => item.name === 'workflow-delay-wakeup') ? 'healthy' : 'warning'),
    ]),
    component('timeoutProcessor', worstStatus([queueStatus('timeouts'), scheduler.registeredHandlers.includes('processWorkflowTaskTimeouts') ? 'healthy' : 'warning']), [
      metric('待处理超时', timeoutTasks.length, timeoutTasks.length > 0 ? 'warning' : 'healthy'),
      metric('近 24h 到期', pendingTasks.filter((task) => isDateTimeDue(task.timeoutAt, dueSoon)).length),
      metric('Cron Handler', scheduler.registeredHandlers.includes('processWorkflowTaskTimeouts') ? '已注册' : '未注册', scheduler.registeredHandlers.includes('processWorkflowTaskTimeouts') ? 'healthy' : 'warning'),
    ]),
    component('triggerDispatcher', worstStatus([queueStatus('triggerDispatch'), componentStatusByIssue('triggerDispatcher')]), [
      metric('任务数', triggerTasks.length),
      metric('重试中', triggerTasks.filter((task) => task.triggerDispatchStatus === 'retrying').length),
      metric('失败', triggerTasks.filter((task) => task.triggerDispatchStatus === 'failed').length, triggerTasks.some((task) => task.triggerDispatchStatus === 'failed') ? 'critical' : 'healthy'),
      metric('失败执行记录', triggerExecutions.filter((item) => item.status === 'failed').length),
    ]),
    component('externalApprover', worstStatus([queueStatus('externalApprovals'), componentStatusByIssue('externalApprover')]), [
      metric('等待外部回调', externalTasks.filter((task) => task.status === 'waiting').length),
      metric('分派失败', externalTasks.filter((task) => task.externalDispatchStatus === 'failed').length, externalTasks.some((task) => task.externalDispatchStatus === 'failed') ? 'critical' : 'healthy'),
      metric('fallback', externalTasks.filter((task) => task.externalDispatchStatus === 'fallback').length),
    ]),
    component('subProcessRecovery', worstStatus([queueStatus('subProcessJoin'), componentStatusByIssue('subProcessRecovery')]), [
      metric('等待汇聚', subProcessTasks.length),
      metric('Cron Handler', scheduler.registeredHandlers.includes('recoverStuckWorkflowSubProcesses') ? '已注册' : '未注册', scheduler.registeredHandlers.includes('recoverStuckWorkflowSubProcesses') ? 'healthy' : 'warning'),
    ]),
    component('eventBus', eventBus.totalListenerCount > 0 ? 'healthy' : 'critical', [
      metric('监听器总数', eventBus.totalListenerCount, eventBus.totalListenerCount > 0 ? 'healthy' : 'critical'),
      metric('事件类型', eventBus.listeners.length),
    ], { listeners: eventBus.listeners }),
    component('outbox', worstStatus([queueStatus('eventOutbox'), componentStatusByIssue('outbox')]), [
      metric('pending', pendingOutbox.length),
      metric('retrying', retryingOutbox.length),
      metric('failed', failedOutbox.length, failedOutbox.length > 0 ? 'critical' : 'healthy'),
    ]),
    component('scheduler', scheduler.initialized ? 'healthy' : 'critical', [
      metric('初始化', scheduler.initialized ? '是' : '否', scheduler.initialized ? 'healthy' : 'critical'),
      metric('运行中 Job', scheduler.runningJobCount),
      metric('系统周期任务', scheduler.systemRecurringJobs.length),
      metric('系统队列 Worker', scheduler.systemQueueWorkers.length),
    ], { wip: scheduler.wip }),
  ];

  const eventStats = eventStatsRows[0] ?? { total1h: 0, success1h: 0, failed1h: 0, total24h: 0, success24h: 0, failed24h: 0, totalPrev24h: 0, successPrev24h: 0, failedPrev24h: 0, pendingRetry: 0, avgLatencyMs: null, p95LatencyMs: null, p99LatencyMs: null, h0: 0, h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, apdexSatisfied: 0, apdexTolerating: 0, apdexFrustrated: 0 };
  const triggerStats = triggerStatsRows[0] ?? { total24h: 0, success24h: 0, failed24h: 0, retrying24h: 0, totalPrev24h: 0, successPrev24h: 0, failedPrev24h: 0, retryingPrev24h: 0, avgDurationMs: null, p95DurationMs: null, p99DurationMs: null, th0: 0, th1: 0, th2: 0, th3: 0, th4: 0, th5: 0, th6: 0 };
  const instanceStats = instanceStatsRows[0] ?? { createdLast24h: 0, completedLast24h: 0, canceledLast24h: 0, createdPrev24h: 0, completedPrev24h: 0 };
  const eventSeries = buildEventSeries(eventSeriesRows, now);
  const instanceSeries = buildInstanceSeries(instanceSeriesRows, now, terminalStatuses);
  const { score: healthScore, breakdown: scoreBreakdown } = computeHealthScore(issues, queues);

  const telemetry: WorkflowEngineTelemetry = {
    healthScore,
    scoreBreakdown,
    apdex: buildApdex(eventStats.apdexSatisfied, eventStats.apdexTolerating, eventStats.apdexFrustrated, apdexT),
    events: {
      last1h: { total: eventStats.total1h, success: eventStats.success1h, failed: eventStats.failed1h },
      last24h: { total: eventStats.total24h, success: eventStats.success24h, failed: eventStats.failed24h },
      prev24h: { total: eventStats.totalPrev24h, success: eventStats.successPrev24h, failed: eventStats.failedPrev24h },
      pendingRetry: eventStats.pendingRetry,
      avgLatencyMs: eventStats.avgLatencyMs != null ? Math.round(eventStats.avgLatencyMs) : null,
      p95LatencyMs: eventStats.p95LatencyMs != null ? Math.round(eventStats.p95LatencyMs) : null,
      p99LatencyMs: eventStats.p99LatencyMs != null ? Math.round(eventStats.p99LatencyMs) : null,
      latencyHistogram: buildHistogram([eventStats.h0, eventStats.h1, eventStats.h2, eventStats.h3, eventStats.h4, eventStats.h5, eventStats.h6]),
      series24h: eventSeries,
    },
    triggers: {
      last24h: { total: triggerStats.total24h, success: triggerStats.success24h, failed: triggerStats.failed24h, retrying: triggerStats.retrying24h },
      prev24h: { total: triggerStats.totalPrev24h, success: triggerStats.successPrev24h, failed: triggerStats.failedPrev24h, retrying: triggerStats.retryingPrev24h },
      avgDurationMs: triggerStats.avgDurationMs != null ? Math.round(triggerStats.avgDurationMs) : null,
      p95DurationMs: triggerStats.p95DurationMs != null ? Math.round(triggerStats.p95DurationMs) : null,
      p99DurationMs: triggerStats.p99DurationMs != null ? Math.round(triggerStats.p99DurationMs) : null,
      durationHistogram: buildHistogram([triggerStats.th0, triggerStats.th1, triggerStats.th2, triggerStats.th3, triggerStats.th4, triggerStats.th5, triggerStats.th6]),
    },
    instances: {
      running: runningInstanceRows.length,
      createdLast24h: instanceStats.createdLast24h,
      completedLast24h: instanceStats.completedLast24h,
      canceledLast24h: instanceStats.canceledLast24h,
      createdPrev24h: instanceStats.createdPrev24h,
      completedPrev24h: instanceStats.completedPrev24h,
      series24h: instanceSeries,
    },
    recurringJobs: scheduler.systemRecurringJobs.map((job) => ({
      name: job.name,
      cronExpression: job.cronExpression,
      registeredAt: job.registeredAt,
      nextRunAt: nextCronRun(job.cronExpression, now),
    })),
  };

  return {
    healthy: !issues.some((issue) => issue.severity === 'critical'),
    generatedAt: formatDateTime(now),
    thresholdMinutes: threshold,
    thresholds: {
      healthWarn: thresholds.healthWarn,
      healthCritical: thresholds.healthCritical,
      backlogWarn: thresholds.backlogWarn,
      backlogCritical: thresholds.backlogCritical,
      errorRateWarn: thresholds.errorRateWarn,
      errorRateCritical: thresholds.errorRateCritical,
    },
    telemetry,
    components,
    queues,
    definitions: definitionsSnapshot,
    eventBus,
    scheduler,
    runtime: {
      runningInstances: runningInstanceRows.length,
      runningWithoutActiveTasks,
      taskQueue: runtimeTasks.slice(0, 300),
      triggerExecutions,
      outboxEvents,
    },
    issues,
  };
}
