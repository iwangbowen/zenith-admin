import { runtimeTimeoutAction } from '../../../services/workflow/runtime/effect-policy';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { WorkflowTimeoutConfig } from '@zenith/shared/workflow';
import { db } from '../../../db';
import { workflowTransaction } from '../lease';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import { approveTaskCore, rejectTaskCore, systemTransferTaskToManagerInTransaction, mapTask } from '../../../services/workflow/workflow-instances.service';
import { resolveTimeoutTransferTarget } from '../../../services/workflow/workflow-assignee-resolver.service';
import { loadTaskHandledUserIds } from '../../../services/workflow/instances/transfers';
import { computeTimeoutAt } from '../../workflow-timeout';
import { workflowEventBus } from '../../workflow-event-bus';
import logger from '../../logger';
import { enqueueJob } from '../engine';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { snapshotNodeConfig, requireNumber } from './shared';
import { runWorkflowJobStep } from '../steps';
import type { DbExecutor } from '../../../db/types';
import { nullableEq } from '../../where-helpers';

const ACTOR = { userId: 0, name: 'system:timeout' } as const;
type TaskRow = typeof workflowTasks.$inferSelect;

function pendingTaskWhere(task: TaskRow) {
  return and(eq(workflowTasks.id, task.id), eq(workflowTasks.instanceId, task.instanceId),
    eq(workflowTasks.status, 'pending'), nullableEq(workflowTasks.assigneeId, task.assigneeId));
}

async function assertCurrentTask(executor: DbExecutor, task: TaskRow) {
  const [current] = await executor.select({ id: workflowTasks.id }).from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowInstances.id, workflowTasks.instanceId))
    .where(and(pendingTaskWhere(task), eq(workflowInstances.status, 'running'))).limit(1);
  if (!current) throw new WorkflowJobSkip('任务或流程状态已变化，超时不再处理');
}

/** 排下一次超时作业（reminder 续期 / 转交后重新计时） */
async function scheduleNextTimeout(
  job: Pick<WorkflowJobContext['job'], 'id' | 'tenantId'>,
  task: TaskRow,
  cfg: WorkflowTimeoutConfig,
  remindCount: number,
  executor: DbExecutor,
): Promise<void> {
  const runAt = computeTimeoutAt(cfg, new Date());
  if (!runAt) return;
  await enqueueJob({
    jobType: 'task_timeout',
    instanceId: task.instanceId,
    nodeKey: task.nodeKey,
    tenantId: job.tenantId,
    taskId: task.id,
    payload: { taskId: task.id, remindCount },
    runAt,
    maxAttempts: 3,
    idempotencyKey: `task_timeout:${task.id}:after-job:${job.id}`,
  }, executor);
}

/**
 * task_timeout：单个审批任务超时处理（提醒 / 自动通过 / 自动拒绝 / 升级转交）。
 * per-task 单作业 + 续期靠重新入队（无全表扫描）。
 * payload: { taskId, remindCount? }
 */
async function handle({ job, payload }: WorkflowJobContext): Promise<void> {
  let taskId: number;
  try {
    taskId = requireNumber(payload, 'taskId');
  } catch (err) {
    throw new WorkflowJobPermanentError(`task_timeout: ${(err as Error).message}`);
  }
  const remindCount = Number(payload.remindCount ?? 0);
  if (!Number.isSafeInteger(taskId) || taskId <= 0 || job.taskId !== taskId || !Number.isSafeInteger(remindCount) || remindCount < 0) {
    throw new WorkflowJobPermanentError('task_timeout: 作业任务或提醒计数无效');
  }

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.status !== 'pending') throw new WorkflowJobSkip('任务已非 pending，超时不再处理');
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new WorkflowJobSkip('实例不存在');
  if (job.instanceId !== inst.id || job.tenantId !== inst.tenantId || (job.nodeKey !== null && job.nodeKey !== task.nodeKey)) {
    throw new WorkflowJobPermanentError('task_timeout: 作业与任务归属不一致');
  }
  // 挂起会撤销当前租约。在锁内复核，避免领取恰好与旧作业的挂起并发时丢掉后续定时。
  if (inst.status !== 'running') {
    await workflowTransaction(tx => assertCurrentTask(tx, task));
  }
  const cfg = snapshotNodeConfig(inst, task.nodeKey)?.timeout;
  if (!cfg || !cfg.enabled) throw new WorkflowJobSkip('节点超时配置已移除');
  if (task.slaDeadline && !task.breachedAt) await workflowTransaction(async tx => {
    await assertCurrentTask(tx, task);
    await tx.update(workflowTasks).set({ breachedAt: task.slaDeadline }).where(and(pendingTaskWhere(task), isNull(workflowTasks.breachedAt)));
  });

  const effectiveAction = runtimeTimeoutAction(cfg, remindCount);
  if (effectiveAction === 'autoApprove' && cfg.action === 'autoApprove') {
    await approveTaskCore(task, inst, '系统超时自动通过', ACTOR);
    return;
  }
  if (effectiveAction === 'autoReject' && cfg.action === 'autoReject') {
    await rejectTaskCore(task, inst, '系统超时自动拒绝', ACTOR);
    return;
  }

  // action = 'remind'
  const nextCount = remindCount + 1;
  const maxRemind = cfg.remindCount ?? 3;
  if (effectiveAction === 'remind') {
    logger.info('workflow task timeout remind', { taskId, instanceId: inst.id, nextCount, maxRemind });
    // 复用催办事件链路，向处理人发送站内信与 WS 提醒。
    await runWorkflowJobStep('timeout-reminder', async (tx) => {
      await assertCurrentTask(tx, task);
      const event = await workflowEventBus.emitInTx({
        type: 'task.urged',
        instanceId: inst.id,
        definitionId: inst.definitionId,
        tenantId: inst.tenantId,
        actor: ACTOR,
        task: mapTask(task),
        comment: `第 ${nextCount}/${maxRemind} 次超时提醒，任务已超过处理时限，请尽快处理`,
      } as Parameters<typeof workflowEventBus.emitInTx>[0], tx);
      await scheduleNextTimeout(job, task, cfg, nextCount, tx);
      return { eventId: event.eventId };
    });
    return;
  }

  // 提醒耗尽 → 升级
  const escalate = cfg.escalateAction ?? 'none';
  if (escalate === 'autoApprove') {
    await approveTaskCore(task, inst, '系统超时（提醒耗尽）自动通过', ACTOR);
    return;
  }
  if (escalate === 'autoReject') {
    await rejectTaskCore(task, inst, '系统超时（提醒耗尽）自动拒绝', ACTOR);
    return;
  }
  if (escalate === 'transferToManager') {
    const result = await runWorkflowJobStep('timeout-transfer', async (tx) => {
      await assertCurrentTask(tx, task);
      const handled = await loadTaskHandledUserIds(taskId, tx);
      if (task.originalAssigneeId !== null) handled.add(task.originalAssigneeId);
      const siblingTasks = await tx.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
        .where(and(eq(workflowTasks.instanceId, inst.id), eq(workflowTasks.nodeKey, task.nodeKey),
          nullableEq(workflowTasks.activationId, task.activationId), inArray(workflowTasks.status, ['pending', 'waiting']), ne(workflowTasks.id, task.id)));
      for (const sibling of siblingTasks) if (sibling.assigneeId !== null) handled.add(sibling.assigneeId);
      const target = await resolveTimeoutTransferTarget(inst.tenantId, task.assigneeId, cfg.escalateManagerLevel ?? 1, handled, tx);
      if (!target) return { noTarget: true, transferred: false, targetUserId: null };
      const transferred = await systemTransferTaskToManagerInTransaction(
        tx, task, inst, target.userId, null,
        `[系统超时] 提醒耗尽，自动转交给${target.reason}处理`,
      );
      if (transferred) await scheduleNextTimeout(job, task, cfg, 0, tx);
      return { noTarget: false, transferred, targetUserId: target.userId };
    });
    if (result.transferred) logger.info('workflow task timeout escalate transfer', { taskId, instanceId: inst.id, targetUserId: result.targetUserId });
    if (!result.noTarget) return;
    // 无人可转 → fallback
    const fallback = cfg.escalateFallbackAction ?? 'none';
    if (fallback === 'autoApprove') {
      await approveTaskCore(task, inst, '系统超时（无人可转）自动通过', ACTOR);
    } else if (fallback === 'autoReject') {
      await rejectTaskCore(task, inst, '系统超时（无人可转）自动拒绝', ACTOR);
    } else {
      logger.warn('workflow task timeout escalate: no transfer fallback target', { taskId, instanceId: inst.id, assigneeId: task.assigneeId });
    }
    return;
  }
  // escalate = 'none'：保持挂起，不再续期
}

registerJobHandler('task_timeout', handle);
