import { eq } from 'drizzle-orm';
import type { WorkflowTimeoutConfig } from '@zenith/shared';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import type { workflowTasks as workflowTasksTable } from '../../../db/schema';
import { approveTaskCore, rejectTaskCore, systemTransferTaskToManager, mapTask } from '../../../services/workflow/workflow-instances.service';
import { resolveAdminUserId, resolveUserManagerId, resolveUserDeptHeadId } from '../../../services/workflow/workflow-assignee-resolver.service';
import { computeTimeoutAt } from '../../workflow-timeout';
import { workflowEventBus } from '../../workflow-event-bus';
import logger from '../../logger';
import { enqueueJob } from '../engine';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { snapshotNodeConfig, requireNumber } from './shared';

const ACTOR = { userId: 0, name: 'system:timeout' } as const;
type TaskRow = typeof workflowTasksTable.$inferSelect;

/** 解析超时升级转交目标：上级 → 部门负责人 → 管理员 */
async function resolveTransferFallbackTarget(task: TaskRow, cfg: WorkflowTimeoutConfig): Promise<{ userId: number; reason: string } | null> {
  if (!task.assigneeId) {
    const adminId = await resolveAdminUserId();
    return adminId ? { userId: adminId, reason: '管理员' } : null;
  }
  const managerId = await resolveUserManagerId(task.assigneeId, cfg.escalateManagerLevel ?? 1);
  if (managerId && managerId !== task.assigneeId) return { userId: managerId, reason: '上级' };
  const deptHeadId = await resolveUserDeptHeadId(task.assigneeId);
  if (deptHeadId && deptHeadId !== task.assigneeId) return { userId: deptHeadId, reason: '部门负责人' };
  const adminId = await resolveAdminUserId();
  if (adminId && adminId !== task.assigneeId) return { userId: adminId, reason: '管理员' };
  return null;
}

/** 排下一次超时作业（reminder 续期 / 转交后重新计时） */
async function scheduleNextTimeout(taskId: number, cfg: WorkflowTimeoutConfig, remindCount: number, keySuffix: string): Promise<void> {
  const runAt = computeTimeoutAt(cfg, new Date());
  if (!runAt) return;
  await enqueueJob({
    jobType: 'task_timeout',
    taskId,
    payload: { taskId, remindCount },
    runAt,
    maxAttempts: 3,
    idempotencyKey: `task_timeout:${taskId}:${keySuffix}`,
  });
}

/**
 * task_timeout：单个审批任务超时处理（提醒 / 自动通过 / 自动拒绝 / 升级转交）。
 * 取代 workflow-timeout-processor.ts 的全表扫描，改为 per-task 单作业 + 续期靠重新入队。
 * payload: { taskId, remindCount? }
 */
async function handle({ payload }: WorkflowJobContext): Promise<void> {
  let taskId: number;
  try {
    taskId = requireNumber(payload, 'taskId');
  } catch (err) {
    throw new WorkflowJobPermanentError(`task_timeout: ${(err as Error).message}`);
  }
  const remindCount = Number(payload.remindCount ?? 0);

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.status !== 'pending') throw new WorkflowJobSkip('任务已非 pending，超时不再处理');
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') throw new WorkflowJobSkip('实例不在运行中');

  const cfg = snapshotNodeConfig(inst, task.nodeKey)?.timeout;
  if (!cfg || !cfg.enabled) throw new WorkflowJobSkip('节点超时配置已移除');

  if (cfg.action === 'autoApprove') {
    await approveTaskCore(task, inst, '系统超时自动通过', ACTOR);
    return;
  }
  if (cfg.action === 'autoReject') {
    await rejectTaskCore(task, inst, '系统超时自动拒绝', ACTOR);
    return;
  }

  // action = 'remind'
  const nextCount = remindCount + 1;
  const maxRemind = cfg.remindCount ?? 3;
  if (nextCount < maxRemind) {
    logger.info('workflow task timeout remind', { taskId, instanceId: inst.id, nextCount, maxRemind });
    // 复用催办事件链路：处理人收到站内信 + WS 提醒（此前仅记日志，处理人无感知）
    workflowEventBus.emit({
      type: 'task.urged',
      instanceId: inst.id,
      definitionId: inst.definitionId,
      tenantId: inst.tenantId,
      actor: ACTOR,
      task: mapTask(task),
      comment: `第 ${nextCount}/${maxRemind} 次超时提醒，任务已超过处理时限，请尽快处理`,
    } as Parameters<typeof workflowEventBus.emit>[0]);
    await scheduleNextTimeout(taskId, cfg, nextCount, `r${nextCount}`);
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
    const target = await resolveTransferFallbackTarget(task, cfg);
    if (target) {
      await systemTransferTaskToManager(task, inst, target.userId, null, `[系统超时] 提醒耗尽，自动转交给${target.reason}处理`);
      logger.info('workflow task timeout escalate transfer', { taskId, instanceId: inst.id, targetUserId: target.userId, reason: target.reason });
      await scheduleNextTimeout(taskId, cfg, 0, `xfer:${target.userId}`);
      return;
    }
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
