// ─── 任务异步作业（延时唤醒/触发器重试/超时）（拆分自 workflow-instances.service.ts）───
import { db } from '../../../db';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import { type TaskAction } from '../../../lib/workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
import type { DbExecutor } from '../../../db/types';
import { enqueueJob } from '../../../lib/workflow-jobs/engine';
import { computeTimeoutAt } from '../../../lib/workflow-timeout';
import type { WorkflowTriggerNodeConfig } from '@zenith/shared/workflow';
import dayjs from 'dayjs';

/**
 * 子实例结束后入队 subprocess_join 作业唤醒/汇聚父任务（取代直接 resumeParentSubProcess 调用）。
 * 幂等键含 childInst.id，确保每个子实例的结束都触发一次（多实例汇聚靠 reconcile 绝对重算收敛）。
 */
export async function enqueueSubprocessJoin(childInst: typeof workflowInstances.$inferSelect, executor: DbExecutor = db): Promise<void> {
  if (!childInst.parentTaskId || !['approved', 'rejected', 'withdrawn', 'cancelled'].includes(childInst.status)) return;
  await enqueueJob({
    jobType: 'subprocess_join',
    taskId: childInst.parentTaskId,
    instanceId: childInst.parentInstanceId ?? null,
    payload: { parentTaskId: childInst.parentTaskId },
    maxAttempts: 5,
    idempotencyKey: `subprocess_join:${childInst.parentTaskId}:${childInst.id}`,
    tenantId: childInst.tenantId ?? null,
  }, executor);
}

function computeDelayWakeAt(nodeConfig: TaskAction['nodeConfig'], formData: Record<string, unknown>): Date {
  const delayType = nodeConfig.delayType ?? 'fixed';
  if (delayType === 'toDate') {
    const key = nodeConfig.targetDate;
    const raw = key ? formData[key] : undefined;
    if (raw) {
      const d = dayjs(raw as string | number | Date);
      if (d.isValid()) return d.toDate();
    }
    return new Date();
  }
  const value = Number(nodeConfig.delayValue ?? 0);
  const unit = (nodeConfig.delayUnit ?? 'hour') as 'minute' | 'hour' | 'day';
  if (!Number.isFinite(value) || value <= 0) return new Date();
  return dayjs().add(value, unit).toDate();
}

/** 触发器最大尝试次数：continue=1，block=1+maxRetries（封顶 11） */
function resolveTriggerMaxAttempts(cfg?: WorkflowTriggerNodeConfig): number {
  const onFailure = cfg?.onFailure ?? 'continue';
  if (onFailure === 'continue') return 1;
  return Math.min(11, Math.max(1, (cfg?.maxRetries ?? 0) + 1));
}

/**
 * 为新建任务挂载异步作业（统一作业账本）：延时唤醒、审批超时、触发器派发、外部审批派发。
 * 子流程（spawn/join）仍走既有 maybeSpawnSubProcessChild / 恢复巡检，不在此处理。
 * 默认用 db 执行器（在提交后的事件发射循环中调用）。
 */
export async function armTaskAsyncJobs(
  task: typeof workflowTasks.$inferSelect,
  inst: { id: number; flowData: WorkflowFlowData | null; formData: Record<string, unknown> | null; tenantId: number | null },
  executor: DbExecutor = db,
): Promise<void> {
  const cfg = inst.flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
  if (!cfg) return;
  const tenantId = inst.tenantId ?? null;
  const base = { instanceId: inst.id, nodeKey: task.nodeKey, taskId: task.id, tenantId, payload: { taskId: task.id } } as const;

  if (task.nodeType === 'subProcess') {
    await enqueueJob({ ...base, jobType: 'subprocess_spawn', maxAttempts: 5, idempotencyKey: `subprocess_spawn:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'delay' && task.status === 'waiting') {
    await enqueueJob({ ...base, jobType: 'delay_wake', runAt: computeDelayWakeAt(cfg, (inst.formData ?? {}) as Record<string, unknown>), maxAttempts: 3, idempotencyKey: `delay_wake:${task.id}` }, executor);
    return;
  }
  if (task.nodeType === 'trigger') {
    await enqueueJob({
      ...base,
      jobType: 'trigger_dispatch',
      // triggerType 只存在于定义快照的节点配置，读取侧拿不到，随作业落库；
      // nodeName 不复制，读取侧从 workflow_tasks.node_name 取权威值
      payload: { taskId: task.id, triggerType: cfg.triggerConfig?.triggerType ?? 'webhook' },
      maxAttempts: resolveTriggerMaxAttempts(cfg.triggerConfig),
      idempotencyKey: `trigger_dispatch:${task.id}`,
    }, executor);
    return;
  }
  if (task.nodeType === 'approve' && task.status === 'waiting' && task.externalCallbackId && cfg.externalApproval?.enabled) {
    await enqueueJob({ ...base, jobType: 'external_dispatch', maxAttempts: 3, idempotencyKey: `external_dispatch:${task.id}` }, executor);
    return;
  }
  if ((task.nodeType === 'approve' || task.nodeType === 'handler') && task.status === 'pending') {
    const timeoutAt = computeTimeoutAt(cfg.timeout);
    if (timeoutAt) {
      await enqueueJob({ ...base, jobType: 'task_timeout', runAt: timeoutAt, maxAttempts: 3, idempotencyKey: `task_timeout:${task.id}` }, executor);
    }
  }
}
