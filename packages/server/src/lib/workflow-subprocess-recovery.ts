/**
 * 子流程恢复扫描
 *
 * 应对子流程 spawn / resume 这类"提交后异步副作用"在瞬时故障或进程崩溃时丢失，
 * 导致父 subProcess 任务永久挂起（waiting）的问题。对标主流引擎的 job executor 恢复机制，
 * 复用本项目既有的「DB 扫描 + cron」模式（同 processWorkflowTaskTimeouts），保证重启安全。
 *
 * 仅覆盖可幂等安全恢复的场景：
 *  - spawn 恢复：subProcess 任务 waiting 且尚未创建任何子实例（grace 期外）→ 重新发起。
 *    幂等：发起前再次确认"无子实例"；单线程 cron + grace 期规避与即时 spawn 竞态。
 *  - resume 恢复：单实例子实例已结束(approved/rejected)但父任务仍 waiting → 重新唤醒。
 *    幂等：applySubProcessOutputAndResume 内部重读父任务状态，非 waiting 即 no-op；
 *    异步子流程由 resumeParentSubProcess 内部守卫直接跳过。
 *  - 多实例汇聚对账：父任务 waiting 且为多实例 → reconcileMultiSubProcess 基于实际子实例
 *    状态"绝对重算" subDone 与出参聚合，幂等收敛丢失的 settle 回调（健康父任务为 no-op）。
 *
 * 暂不覆盖：多实例"并行初次 spawn 部分失败（部分子实例从未创建）"的补发，需结合循环数据源
 * 逐项核对补建，留待后续。
 */
import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { workflowInstances, workflowTasks } from '../db/schema';
import { maybeSpawnSubProcessChild, resumeParentSubProcess, reconcileMultiSubProcess } from '../services/workflow-instances.service';
import logger from './logger';

const SYSTEM_ACTOR = { userId: 0, name: 'system:subprocess-recovery' } as const;

export async function recoverStuckSubProcesses(graceMinutes = 5): Promise<{ resumed: number; spawned: number; reconciled: number }> {
  const cutoff = new Date(Date.now() - graceMinutes * 60_000);
  let resumed = 0;
  let spawned = 0;
  let reconciled = 0;

  // ── resume 恢复：单实例子实例已结束但父任务仍 waiting ──
  const stuckResumes = await db
    .select({ child: workflowInstances })
    .from(workflowInstances)
    .innerJoin(workflowTasks, eq(workflowTasks.id, workflowInstances.parentTaskId))
    .where(and(
      isNotNull(workflowInstances.parentTaskId),
      inArray(workflowInstances.status, ['approved', 'rejected']),
      eq(workflowTasks.status, 'waiting'),
      eq(workflowTasks.nodeType, 'subProcess'),
      isNull(workflowTasks.subTotal), // 仅单实例；多实例汇聚不在恢复范围
      lte(workflowInstances.updatedAt, cutoff), // 给即时 resume 留出 grace 期
    ));
  for (const { child } of stuckResumes) {
    try {
      await resumeParentSubProcess(child, child.status as 'approved' | 'rejected', SYSTEM_ACTOR);
      resumed += 1;
    } catch (err) {
      logger.error('[subprocess-recovery] resume failed', { childId: child.id, parentTaskId: child.parentTaskId, err });
    }
  }

  // ── spawn 恢复：subProcess 任务 waiting 且尚未起步任何子实例 ──
  const stuckSpawns = await db.select().from(workflowTasks)
    .where(and(
      eq(workflowTasks.nodeType, 'subProcess'),
      eq(workflowTasks.status, 'waiting'),
      isNull(workflowTasks.subTotal), // 单实例 / 多实例尚未起步（多实例起步后 subTotal 非空，不重试）
      lte(workflowTasks.createdAt, cutoff),
    ));
  for (const task of stuckSpawns) {
    try {
      // 幂等：已存在子实例则视为已起步，跳过
      const [existingChild] = await db.select({ id: workflowInstances.id }).from(workflowInstances)
        .where(eq(workflowInstances.parentTaskId, task.id)).limit(1);
      if (existingChild) continue;
      const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
      if (!inst || inst.status !== 'running') continue;
      await maybeSpawnSubProcessChild(inst, task, SYSTEM_ACTOR);
      spawned += 1;
    } catch (err) {
      logger.error('[subprocess-recovery] spawn failed', { taskId: task.id, instanceId: task.instanceId, err });
    }
  }

  // ── 多实例汇聚对账：父任务 waiting 且为多实例（subTotal 非空）→ 基于实际子实例状态重算汇聚 ──
  // reconcileMultiSubProcess 为绝对重算，对健康父任务为 no-op；对丢失 settle 回调的卡死汇聚可收敛。
  const stuckMulti = await db.select({ id: workflowTasks.id, instanceId: workflowTasks.instanceId }).from(workflowTasks)
    .where(and(
      eq(workflowTasks.nodeType, 'subProcess'),
      eq(workflowTasks.status, 'waiting'),
      isNotNull(workflowTasks.subTotal),
      lte(workflowTasks.createdAt, cutoff),
    ));
  for (const t of stuckMulti) {
    try {
      await reconcileMultiSubProcess(t.id, t.instanceId, SYSTEM_ACTOR);
      reconciled += 1;
    } catch (err) {
      logger.error('[subprocess-recovery] multi reconcile failed', { taskId: t.id, instanceId: t.instanceId, err });
    }
  }

  if (resumed > 0 || spawned > 0 || reconciled > 0) {
    logger.info('[subprocess-recovery] recovered stuck subprocesses', { resumed, spawned, reconciled });
  }
  return { resumed, spawned, reconciled };
}
