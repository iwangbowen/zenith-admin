import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { workflowTasks, workflowInstances } from '../db/schema';
import { approveTaskCore } from './workflow-instances.service';
import logger from '../lib/logger';
import { HTTPException } from 'hono/http-exception';

/**
 * 唤醒指定的 delay 任务：将其标记为 approved 并推进流程。
 * 由 delay-scheduler 在 wake_at 到达时调用，亦可被运维手动触发。
 */
export async function resumeDelayTask(taskId: number): Promise<boolean> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) {
    logger.warn(`resumeDelayTask: task ${taskId} not found`);
    return false;
  }
  if (task.nodeType !== 'delay' || task.status !== 'waiting') {
    return false;
  }
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') {
    return false;
  }
  await approveTaskCore(task, inst, '延迟到期自动唤醒', { userId: 0, name: 'system:delay' });
  return true;
}

/**
 * DB 兜底扫描已到期但仍等待的 delay 任务。
 * 内存 setTimeout 负责准时唤醒；本扫描负责进程重启、timer 丢失或瞬时失败后的恢复。
 */
export async function recoverDueDelayTasks(limit = 100): Promise<{ scanned: number; resumed: number; skipped: number; failed: number }> {
  const now = new Date();
  const dueTasks = await db
    .select({ id: workflowTasks.id })
    .from(workflowTasks)
    .where(and(
      eq(workflowTasks.nodeType, 'delay'),
      eq(workflowTasks.status, 'waiting'),
      isNotNull(workflowTasks.wakeAt),
      lte(workflowTasks.wakeAt, now),
    ))
    .orderBy(asc(workflowTasks.wakeAt))
    .limit(Math.max(1, Math.min(limit, 500)));

  let resumed = 0;
  let skipped = 0;
  let failed = 0;
  for (const task of dueTasks) {
    try {
      const ok = await resumeDelayTask(task.id);
      if (ok) resumed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      logger.error('[workflow-delay-recovery] failed to resume due delay task', { taskId: task.id, err });
    }
  }

  if (resumed > 0 || failed > 0) {
    logger.info('[workflow-delay-recovery] scanned due delay tasks', { scanned: dueTasks.length, resumed, skipped, failed });
  }
  return { scanned: dueTasks.length, resumed, skipped, failed };
}

/**
 * 触发器回调唤醒：通过 externalCallbackId 找到等待中的 trigger 任务，标记为 approved 并推进流程。
 * 供 /api/public/workflow/trigger-callback 路由调用。
 */
export async function resumeTriggerTask(
  callbackId: string,
  comment: string | undefined,
  callerName: string,
): Promise<{ instanceId: number; nodeKey: string }> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  if (task.nodeType !== 'trigger') throw new HTTPException(400, { message: '该回调不属于触发器任务' });
  if (task.status !== 'waiting') throw new HTTPException(400, { message: '回调任务已处理' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  await approveTaskCore(task, inst, comment ?? `触发器回调：${callerName}`, { userId: 0, name: `trigger:${callerName}` });
  return { instanceId: inst.id, nodeKey: task.nodeKey };
}
