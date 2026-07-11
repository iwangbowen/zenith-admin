import { and, desc, eq, inArray, lte, type SQL } from 'drizzle-orm';
import type { WorkflowHealthIssue, WorkflowHealthSummary } from '@zenith/shared';
import { db } from '../../db';
import { workflowJobExecutions, workflowJobs, workflowInstances, workflowTasks } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { tenantCondition } from '../../lib/tenant';

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
    ? await db.select({ taskId: workflowJobs.taskId })
      .from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .where(and(eq(workflowJobExecutions.jobType, 'trigger_dispatch'), inArray(workflowJobs.taskId, triggerTaskIds)))
    : [];
  const triggerTaskIdsWithExecution = new Set(triggerExecutions.map((row) => row.taskId).filter((id): id is number => typeof id === 'number'));

  const taskIds = taskRows.map((row) => row.task.id);
  const taskJobRows = taskIds.length > 0
    ? await db.select().from(workflowJobs).where(and(
      inArray(workflowJobs.taskId, taskIds),
      inArray(workflowJobs.jobType, ['external_dispatch', 'trigger_dispatch', 'delay_wake', 'task_timeout']),
    ))
    : [];
  const jobsByTask = new Map<number, Array<typeof workflowJobs.$inferSelect>>();
  for (const job of taskJobRows) {
    if (!job.taskId) continue;
    const items = jobsByTask.get(job.taskId) ?? [];
    items.push(job);
    jobsByTask.set(job.taskId, items);
  }
  const findJob = (taskId: number, jobType: typeof workflowJobs.$inferSelect['jobType']) =>
    jobsByTask.get(taskId)?.find((job) => job.jobType === jobType) ?? null;

  const issues: WorkflowHealthIssue[] = [];
  for (const row of taskRows) {
    const { task } = row;
    const externalJob = findJob(task.id, 'external_dispatch');
    const triggerJob = findJob(task.id, 'trigger_dispatch');
    const delayJob = findJob(task.id, 'delay_wake');
    const timeoutJob = findJob(task.id, 'task_timeout');
    if (externalJob && ['failed', 'dead'].includes(externalJob.status)) {
      issues.push(taskIssue({
        type: 'external_dispatch_failed',
        severity: 'critical',
        title: '外部审批分派失败',
        description: externalJob.lastError ?? `外部审批分派作业处于 ${externalJob.status} 状态，需要检查外部审批配置或手动处理。`,
        row,
        now,
      }));
      continue;
    }
    if (externalJob?.status === 'pending') {
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
    if (task.nodeType === 'trigger' && task.status === 'waiting' && triggerJob && ['failed', 'dead'].includes(triggerJob.status)) {
      issues.push(taskIssue({
        type: 'trigger_execution_failed',
        severity: 'critical',
        title: '触发器执行失败',
        description: triggerJob.lastError
          ? `触发器最终执行失败：${triggerJob.lastError}`
          : '触发器最终执行失败，流程仍在等待该节点处理。',
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
    if (task.nodeType === 'delay' && task.status === 'waiting' && !delayJob) {
      issues.push(taskIssue({
        type: 'delay_missing_wake_job',
        severity: 'critical',
        title: '延迟节点缺少唤醒作业',
        description: '延迟任务在等待，但找不到对应的 delay_wake 作业，任务将无法被自动唤醒；可在流程监控执行「恢复延迟」修复。',
        row,
        now,
      }));
      continue;
    }
    if (task.nodeType === 'delay' && task.status === 'waiting' && delayJob?.status === 'pending' && delayJob.runAt <= now) {
      issues.push(taskIssue({
        type: 'delay_overdue',
        severity: 'critical',
        title: '延迟节点已到期未唤醒',
        description: '延迟唤醒作业 runAt 已到期但任务仍在等待。',
        row,
        now,
      }));
      continue;
    }
    if (task.status === 'pending' && timeoutJob?.status === 'pending' && timeoutJob.runAt <= now) {
      issues.push(taskIssue({
        type: 'task_timeout_overdue',
        severity: 'warning',
        title: '审批任务已超时未处理',
        description: '审批超时作业 runAt 已到期，等待超时处理器执行。',
        row,
        now,
      }));
    }
  }

  const outboxTenant = tenantCondition(workflowJobs, user);
  const outboxConditions: SQL[] = [
    eq(workflowJobs.jobType, 'event_dispatch'),
    inArray(workflowJobs.status, ['pending', 'failed', 'dead']),
    lte(workflowJobs.createdAt, cutoff),
  ];
  if (outboxTenant) outboxConditions.push(outboxTenant);
  const outboxRows = await db.select().from(workflowJobs)
    .where(and(...outboxConditions))
    .orderBy(desc(workflowJobs.id))
    .limit(100);
  for (const row of outboxRows) {
    const failed = row.status === 'failed' || row.status === 'dead';
    issues.push({
      id: `outbox:${row.id}`,
      type: failed ? 'workflow_event_outbox_failed' : 'workflow_event_outbox_pending',
      severity: failed ? 'critical' : 'warning',
      title: failed ? '事件派发重放失败' : '事件派发待处理过久',
      // TODO(workflow-jobs P5): event_dispatch jobs no longer expose old outbox eventType/status fields one-to-one.
      description: failed ? (row.lastError ?? '事件派发作业失败，请查看服务日志。') : '事件派发作业超过阈值仍未处理。',
      instanceId: row.instanceId ?? null,
      taskId: row.taskId ?? null,
      nodeKey: null,
      nodeName: null,
      status: failed ? 'failed' : 'pending',
      ageMinutes: ageMinutes(row.createdAt, now),
      createdAt: formatDateTime(row.createdAt),
    });
  }

  // 卡死实例：running 且超阈值未更新，既无待办/等待任务也无在途作业
  // （典型场景：并行汇聚残留孤儿 parked token、推进链路中断），需人工用监控页恢复动作处理。
  const stalledTenant = tenantCondition(workflowInstances, user);
  const stalledConditions: SQL[] = [
    eq(workflowInstances.status, 'running' as const),
    lte(workflowInstances.updatedAt, cutoff),
  ];
  if (stalledTenant) stalledConditions.push(stalledTenant);
  const runningRows = await db.select({ id: workflowInstances.id, title: workflowInstances.title, updatedAt: workflowInstances.updatedAt })
    .from(workflowInstances)
    .where(and(...stalledConditions))
    .orderBy(desc(workflowInstances.id))
    .limit(200);
  if (runningRows.length > 0) {
    const runningIds = runningRows.map((r) => r.id);
    const [aliveTaskRows, aliveJobRows] = await Promise.all([
      db.select({ instanceId: workflowTasks.instanceId }).from(workflowTasks)
        .where(and(inArray(workflowTasks.instanceId, runningIds), inArray(workflowTasks.status, ['pending', 'waiting']))),
      db.select({ instanceId: workflowJobs.instanceId }).from(workflowJobs)
        .where(and(inArray(workflowJobs.instanceId, runningIds), inArray(workflowJobs.status, ['pending', 'running']))),
    ]);
    const aliveIds = new Set<number>([
      ...aliveTaskRows.map((r) => r.instanceId),
      ...aliveJobRows.map((r) => r.instanceId).filter((id): id is number => id != null),
    ]);
    for (const inst of runningRows) {
      if (aliveIds.has(inst.id)) continue;
      issues.push({
        id: `instance:${inst.id}:stalled`,
        type: 'instance_stalled',
        severity: 'critical',
        title: '实例无可推进项（疑似卡死）',
        description: '实例处于进行中，但没有任何待办/等待任务与在途作业；可能是并行汇聚残留孤儿 Token 或推进中断，请在流程监控查看执行 Token 并使用恢复动作。',
        instanceId: inst.id,
        instanceTitle: inst.title,
        taskId: null,
        nodeKey: null,
        nodeName: null,
        status: 'running',
        ageMinutes: ageMinutes(inst.updatedAt, now),
        createdAt: formatDateTime(inst.updatedAt),
      });
    }
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
      triggerStuck: issues.filter((issue) => issue.type === 'trigger_waiting_no_execution' || issue.type === 'trigger_execution_failed').length,
      subProcessStuck: issues.filter((issue) => issue.type === 'subprocess_waiting').length,
      outboxFailed: issues.filter((issue) => issue.type === 'workflow_event_outbox_failed').length,
    },
    issues,
  };
}
