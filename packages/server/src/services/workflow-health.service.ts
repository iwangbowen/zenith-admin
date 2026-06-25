import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { WorkflowHealthIssue, WorkflowHealthSummary } from '@zenith/shared';
import { db } from '../db';
import { workflowEventOutbox, workflowInstances, workflowTasks, workflowTriggerExecutions } from '../db/schema';
import { currentUser } from '../lib/context';
import { formatDateTime } from '../lib/datetime';
import { tenantCondition } from '../lib/tenant';

type TaskRow = {
  task: typeof workflowTasks.$inferSelect;
  instanceTitle: string;
};

function ageMinutes(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60_000));
}

function taskIssue(input: {
  type: WorkflowHealthIssue['type'];
  severity: WorkflowHealthIssue['severity'];
  title: string;
  description: string;
  row: TaskRow;
  now: Date;
}): WorkflowHealthIssue {
  const { task } = input.row;
  return {
    id: `task:${task.id}:${input.type}`,
    type: input.type,
    severity: input.severity,
    title: input.title,
    description: input.description,
    instanceId: task.instanceId,
    instanceTitle: input.row.instanceTitle,
    taskId: task.id,
    nodeKey: task.nodeKey,
    nodeName: task.nodeName,
    status: task.status,
    ageMinutes: ageMinutes(task.createdAt, input.now),
    createdAt: formatDateTime(task.createdAt),
  };
}

export async function getWorkflowHealthSummary(thresholdMinutes = 30): Promise<WorkflowHealthSummary> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - Math.max(1, thresholdMinutes) * 60_000);
  const user = currentUser();
  const taskTenant = tenantCondition(workflowInstances, user);
  const taskConditions = [
    eq(workflowInstances.status, 'running' as const),
    lte(workflowTasks.createdAt, cutoff),
    inArray(workflowTasks.status, ['pending', 'waiting']),
  ];
  if (taskTenant) taskConditions.push(taskTenant);

  const taskRows = await db.select({
    task: workflowTasks,
    instanceTitle: workflowInstances.title,
  })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(and(...taskConditions))
    .orderBy(desc(workflowTasks.id))
    .limit(300);

  const triggerTaskIds = taskRows
    .filter((row) => row.task.nodeType === 'trigger')
    .map((row) => row.task.id);
  const triggerExecutions = triggerTaskIds.length > 0
    ? await db.select({ taskId: workflowTriggerExecutions.taskId })
      .from(workflowTriggerExecutions)
      .where(inArray(workflowTriggerExecutions.taskId, triggerTaskIds))
    : [];
  const triggerTaskIdsWithExecution = new Set(triggerExecutions.map((row) => row.taskId).filter((id): id is number => typeof id === 'number'));

  const issues: WorkflowHealthIssue[] = [];
  for (const row of taskRows) {
    const { task } = row;
    if (task.externalDispatchStatus === 'failed' || task.externalDispatchStatus === 'fallback') {
      issues.push(taskIssue({
        type: 'external_dispatch_failed',
        severity: 'critical',
        title: '外部审批分派失败',
        description: `外部审批任务处于 ${task.externalDispatchStatus} 状态，需要检查外部审批配置或手动处理。`,
        row,
        now,
      }));
      continue;
    }
    if (task.externalDispatchStatus === 'pending') {
      issues.push(taskIssue({
        type: 'external_dispatch_pending',
        severity: 'warning',
        title: '外部审批尚未分派',
        description: '任务已等待超过阈值但仍未派发到外部审批系统。',
        row,
        now,
      }));
      continue;
    }
    if (task.nodeType === 'trigger' && task.status === 'waiting' && !triggerTaskIdsWithExecution.has(task.id)) {
      issues.push(taskIssue({
        type: 'trigger_waiting_no_execution',
        severity: 'critical',
        title: '触发器未生成执行记录',
        description: '触发器任务已等待超过阈值，但没有对应执行记录，可能是运行时事件丢失。',
        row,
        now,
      }));
      continue;
    }
    if (task.nodeType === 'subProcess' && task.status === 'waiting') {
      issues.push(taskIssue({
        type: 'subprocess_waiting',
        severity: 'warning',
        title: '子流程等待过久',
        description: '子流程父任务等待超过阈值，请检查子实例是否创建或是否已结束未唤醒父流程。',
        row,
        now,
      }));
      continue;
    }
    if (task.nodeType === 'delay' && task.status === 'waiting' && task.wakeAt && task.wakeAt <= now) {
      issues.push(taskIssue({
        type: 'delay_overdue',
        severity: 'critical',
        title: '延迟节点已到期未唤醒',
        description: '延迟任务 wakeAt 已到期但仍在等待。',
        row,
        now,
      }));
      continue;
    }
    if (task.status === 'pending' && task.timeoutAt && task.timeoutAt <= now) {
      issues.push(taskIssue({
        type: 'task_timeout_overdue',
        severity: 'warning',
        title: '审批任务已超时未处理',
        description: '审批任务 timeoutAt 已到期，等待超时处理器执行。',
        row,
        now,
      }));
    }
  }

  const outboxTenant = tenantCondition(workflowEventOutbox, user);
  const outboxConditions = [
    inArray(workflowEventOutbox.status, ['pending', 'failed']),
    lte(workflowEventOutbox.createdAt, cutoff),
  ];
  if (outboxTenant) outboxConditions.push(outboxTenant);
  const outboxRows = await db.select().from(workflowEventOutbox)
    .where(and(...outboxConditions))
    .orderBy(desc(workflowEventOutbox.id))
    .limit(100);
  for (const row of outboxRows) {
    const failed = row.status === 'failed';
    issues.push({
      id: `outbox:${row.id}`,
      type: failed ? 'workflow_event_outbox_failed' : 'workflow_event_outbox_pending',
      severity: failed ? 'critical' : 'warning',
      title: failed ? '工作流事件 outbox 重放失败' : '工作流事件 outbox 待处理过久',
      description: failed ? (row.errorMessage ?? '事件重放失败，请查看服务日志。') : '事件已进入 outbox 但超过阈值仍未处理。',
      instanceId: row.instanceId ?? null,
      taskId: row.taskId ?? null,
      nodeKey: null,
      nodeName: null,
      status: row.status,
      ageMinutes: ageMinutes(row.createdAt, now),
      createdAt: formatDateTime(row.createdAt),
    });
  }

  issues.sort((a, b) => {
    const severity = (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0);
    return severity || b.ageMinutes - a.ageMinutes;
  });

  const critical = issues.filter((issue) => issue.severity === 'critical').length;
  const warning = issues.length - critical;
  return {
    healthy: issues.length === 0,
    checkedAt: formatDateTime(now),
    thresholdMinutes,
    stats: {
      total: issues.length,
      critical,
      warning,
      externalFailed: issues.filter((issue) => issue.type === 'external_dispatch_failed').length,
      triggerStuck: issues.filter((issue) => issue.type === 'trigger_waiting_no_execution').length,
      subProcessStuck: issues.filter((issue) => issue.type === 'subprocess_waiting').length,
      outboxFailed: issues.filter((issue) => issue.type === 'workflow_event_outbox_failed').length,
    },
    issues,
  };
}
