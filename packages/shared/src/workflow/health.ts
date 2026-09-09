import type { WorkflowHealthIssue, WorkflowHealthSummary } from './contracts/health';
import type { WorkflowEngineDefinitionSnapshot, WorkflowEngineIntrospection, WorkflowEngineOutboxEvent, WorkflowEngineQueueSnapshot, WorkflowEngineRuntimeIssue, WorkflowEngineRuntimeTask, WorkflowEngineTriggerExecution } from './contracts/engine';
import type { WorkflowEngineComponentStatus, WorkflowEngineQueueKey } from './types';

/** 巡检问题排序：critical 优先，其后按滞留时长倒序（返回新数组） */
export function sortWorkflowHealthIssues(issues: readonly WorkflowHealthIssue[]): WorkflowHealthIssue[] {
  return [...issues].sort((a, b) => {
    const severity = (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0);
    return severity || b.ageMinutes - a.ageMinutes;
  });
}

/**
 * 由问题列表汇总巡检结果：统计口径（按类型归入 外部派发 / 触发器 / 子流程 / outbox 四类）在此唯一定义，
 * 服务端巡检与 Demo Mock 共用，避免两侧统计不一致。
 */
export function summarizeWorkflowHealth(
  issues: readonly WorkflowHealthIssue[],
  meta: { thresholdMinutes: number; checkedAt: string },
): WorkflowHealthSummary {
  const sorted = sortWorkflowHealthIssues(issues);
  const critical = sorted.filter((issue) => issue.severity === 'critical').length;
  return {
    healthy: sorted.length === 0,
    checkedAt: meta.checkedAt,
    thresholdMinutes: meta.thresholdMinutes,
    stats: {
      total: sorted.length,
      critical,
      warning: sorted.length - critical,
      externalFailed: sorted.filter((issue) => issue.type === 'external_dispatch_failed').length,
      triggerStuck: sorted.filter((issue) => issue.type === 'trigger_waiting_no_execution' || issue.type === 'trigger_execution_failed').length,
      subProcessStuck: sorted.filter((issue) => issue.type === 'subprocess_waiting').length,
      outboxFailed: sorted.filter((issue) => issue.type === 'workflow_event_outbox_failed').length,
    },
    issues: sorted,
  };
}

// ─── 引擎巡检（Engine Introspection）─────────────────────────────────────────

/** 多个组件 / 队列状态取最差值：critical > warning > healthy */
export function worstWorkflowEngineStatus(statuses: readonly WorkflowEngineComponentStatus[]): WorkflowEngineComponentStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

/** 队列快照：有失败即 critical，最老积压 ≥ 60 分钟为 warning；计数缺省为 0 */
export function buildWorkflowEngineQueueSnapshot(input: {
  key: WorkflowEngineQueueKey;
  name: string;
  ready?: number;
  running?: number;
  delayed?: number;
  failed?: number;
  oldestAgeMinutes?: number | null;
  details?: Record<string, number | string | null>;
}): WorkflowEngineQueueSnapshot {
  const failed = input.failed ?? 0;
  const stale = input.oldestAgeMinutes != null && input.oldestAgeMinutes >= 60;
  return {
    key: input.key,
    name: input.name,
    status: failed > 0 ? 'critical' : stale ? 'warning' : 'healthy',
    ready: input.ready ?? 0,
    running: input.running ?? 0,
    delayed: input.delayed ?? 0,
    failed,
    oldestAgeMinutes: input.oldestAgeMinutes ?? null,
    details: input.details ?? null,
  };
}

export interface WorkflowEngineIssueSources {
  definitions: Pick<WorkflowEngineDefinitionSnapshot, 'invalidDefinitions'>;
  runningWithoutActiveTasks: WorkflowEngineIntrospection['runtime']['runningWithoutActiveTasks'];
  runtimeTasks: readonly WorkflowEngineRuntimeTask[];
  triggerExecutions: readonly WorkflowEngineTriggerExecution[];
  outboxEvents: readonly WorkflowEngineOutboxEvent[];
  eventBusListeners: number;
  schedulerInitialized: boolean;
}

/** 巡检问题上限：避免大规模积压时把整页 issue 灌回前端 */
export const WORKFLOW_ENGINE_ISSUE_LIMIT = 100;

/**
 * 由引擎运行态快照推导巡检问题列表。规则、文案与严重度在此唯一定义，
 * 服务端巡检与 Demo Mock 共用，避免两侧规则漂移。
 */
export function buildWorkflowEngineIssues(input: WorkflowEngineIssueSources): WorkflowEngineRuntimeIssue[] {
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
      instanceId: inst.instanceId,
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
        instanceId: task.instanceId,
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
        instanceId: task.instanceId,
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
        instanceId: task.instanceId,
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
        instanceId: task.instanceId,
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
      instanceId: execution.instanceId ?? null,
      createdAt: execution.createdAt,
    });
  }
  for (const event of input.outboxEvents.filter((item) => item.status === 'failed')) {
    issues.push({
      id: `outbox:${event.id}`,
      severity: 'critical',
      component: 'outbox',
      title: '事件派发重放失败',
      description: event.errorMessage ?? `事件 ${event.eventType} 重放失败。`,
      refType: 'outbox',
      refId: event.id,
      instanceId: event.instanceId ?? null,
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
  return issues.slice(0, WORKFLOW_ENGINE_ISSUE_LIMIT);
}
