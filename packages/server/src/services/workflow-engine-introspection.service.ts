import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CronExpressionParser } from 'cron-parser';
import type {
  WorkflowEngineComponent,
  WorkflowEngineComponentStatus,
  WorkflowEngineDefinitionSnapshot,
  WorkflowEngineIntrospection,
  WorkflowEngineMetric,
  WorkflowEngineQueueKey,
  WorkflowEngineQueueSnapshot,
  WorkflowEngineRuntimeIssue,
  WorkflowEngineRuntimeTask,
  WorkflowEngineTelemetry,
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
 * 用于顶部 Stat 面板给出规范化健康度（借鉴工业引擎健康度百分比）。
 */
function computeHealthScore(issues: WorkflowEngineRuntimeIssue[], queues: WorkflowEngineQueueSnapshot[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 12;
    else if (issue.severity === 'warning') score -= 4;
  }
  for (const queue of queues) {
    if (queue.failed > 0) score -= 5;
    if (queue.oldestAgeMinutes != null && queue.oldestAgeMinutes >= 60) score -= 3;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function getWorkflowEngineIntrospection(thresholdMinutes = 30): Promise<WorkflowEngineIntrospection> {
  const now = new Date();
  const threshold = Math.max(1, Math.min(thresholdMinutes, 24 * 60));
  const dueSoon = new Date(now.getTime() + 24 * 60 * 60_000);
  const user = currentUser();
  const assigneeUsers = alias(users, 'workflow_engine_task_assignee');
  const instTenant = tenantCondition(workflowInstances, user);
  const defTenant = tenantCondition(workflowDefinitions, user);
  const outboxTenant = tenantCondition(workflowEventOutbox, user);
  const taskScope = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: users.departmentId,
    ownerColumn: workflowInstances.initiatorId,
  });

  const instanceBaseConds: SQL[] = [];
  if (instTenant) instanceBaseConds.push(instTenant);
  if (taskScope) instanceBaseConds.push(taskScope);
  const instanceBaseWhere = whereOrUndefined(instanceBaseConds);

  const taskBaseConds: SQL[] = [eq(workflowInstances.status, 'running')];
  if (instTenant) taskBaseConds.push(instTenant);
  if (taskScope) taskBaseConds.push(taskScope);

  const since1h = new Date(now.getTime() - 60 * 60_000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
  const terminalStatuses = ['approved', 'rejected', 'withdrawn', 'cancelled'] as const;
  const canceledStatuses = ['withdrawn', 'cancelled'] as const;
  const outboxScopeConds: SQL[] = [];
  if (outboxTenant) outboxScopeConds.push(outboxTenant);
  outboxScopeConds.push(or(isNull(workflowEventOutbox.instanceId), instanceBaseWhere ?? sql`true`)!);
  const triggerScopeConds: SQL[] = [];
  if (instTenant) triggerScopeConds.push(instTenant);
  if (taskScope) triggerScopeConds.push(taskScope);

  const [definitions, runningInstanceRows, activeInstanceRows, runtimeTaskRows, triggerRows, outboxRows, eventStatsRows, triggerStatsRows, instanceStatsRows] = await Promise.all([
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
      pendingRetry: sql<number>`count(*) filter (where ${inArray(workflowEventOutbox.status, ['pending', 'processing', 'retrying'])})`.mapWith(Number),
      avgLatencyMs: sql<number | null>`avg(extract(epoch from (${workflowEventOutbox.processedAt} - ${workflowEventOutbox.createdAt})) * 1000) filter (where ${and(eq(workflowEventOutbox.status, 'success'), isNotNull(workflowEventOutbox.processedAt), gte(workflowEventOutbox.createdAt, since24h))})`.mapWith(Number),
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
      avgDurationMs: sql<number | null>`avg(${workflowTriggerExecutions.durationMs}) filter (where ${and(eq(workflowTriggerExecutions.status, 'success'), isNotNull(workflowTriggerExecutions.durationMs), gte(workflowTriggerExecutions.createdAt, since24h))})`.mapWith(Number),
    })
      .from(workflowTriggerExecutions)
      .innerJoin(workflowInstances, eq(workflowTriggerExecutions.instanceId, workflowInstances.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(whereOrUndefined(triggerScopeConds)),
    db.select({
      createdLast24h: sql<number>`count(*) filter (where ${gte(workflowInstances.createdAt, since24h)})`.mapWith(Number),
      completedLast24h: sql<number>`count(*) filter (where ${and(inArray(workflowInstances.status, [...terminalStatuses]), gte(workflowInstances.updatedAt, since24h))})`.mapWith(Number),
      canceledLast24h: sql<number>`count(*) filter (where ${and(inArray(workflowInstances.status, [...canceledStatuses]), gte(workflowInstances.updatedAt, since24h))})`.mapWith(Number),
    })
      .from(workflowInstances)
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(instanceBaseWhere),
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

  const eventStats = eventStatsRows[0] ?? { total1h: 0, success1h: 0, failed1h: 0, total24h: 0, success24h: 0, failed24h: 0, pendingRetry: 0, avgLatencyMs: null };
  const triggerStats = triggerStatsRows[0] ?? { total24h: 0, success24h: 0, failed24h: 0, retrying24h: 0, avgDurationMs: null };
  const instanceStats = instanceStatsRows[0] ?? { createdLast24h: 0, completedLast24h: 0, canceledLast24h: 0 };

  const telemetry: WorkflowEngineTelemetry = {
    healthScore: computeHealthScore(issues, queues),
    events: {
      last1h: { total: eventStats.total1h, success: eventStats.success1h, failed: eventStats.failed1h },
      last24h: { total: eventStats.total24h, success: eventStats.success24h, failed: eventStats.failed24h },
      pendingRetry: eventStats.pendingRetry,
      avgLatencyMs: eventStats.avgLatencyMs != null ? Math.round(eventStats.avgLatencyMs) : null,
    },
    triggers: {
      last24h: { total: triggerStats.total24h, success: triggerStats.success24h, failed: triggerStats.failed24h, retrying: triggerStats.retrying24h },
      avgDurationMs: triggerStats.avgDurationMs != null ? Math.round(triggerStats.avgDurationMs) : null,
    },
    instances: {
      running: runningInstanceRows.length,
      createdLast24h: instanceStats.createdLast24h,
      completedLast24h: instanceStats.completedLast24h,
      canceledLast24h: instanceStats.canceledLast24h,
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
