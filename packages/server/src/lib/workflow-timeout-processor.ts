import { and, eq, lte, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db';
import { workflowTasks, workflowInstances } from '../db/schema';
import { approveTaskCore, rejectTaskCore, systemTransferTaskToManager } from '../services/workflow-instances.service';
import { resolveAdminUserId, resolveUserDeptHeadId, resolveUserManagerId } from '../services/workflow-assignee-resolver.service';
import { computeTimeoutAt } from './workflow-timeout';
import type { WorkflowFlowData, WorkflowNodeConfig, WorkflowTimeoutConfig } from '@zenith/shared';
import logger from './logger';

const SYSTEM_ACTOR = { userId: 0, name: 'system:timeout' } as const;

async function resolveTransferFallbackTarget(task: typeof workflowTasks.$inferSelect, cfg: WorkflowTimeoutConfig): Promise<{ userId: number; reason: string } | null> {
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

/**
 * 扫描所有已超时的 pending 审批任务并执行相应动作。
 * 由 cron 调度器周期性触发（建议每 1-5 分钟）。
 */
export async function processWorkflowTaskTimeouts(): Promise<{ processed: number; reminded: number; approved: number; rejected: number; escalated: number }> {
  const now = new Date();
  const due = await db.select()
    .from(workflowTasks)
    .where(and(eq(workflowTasks.status, 'pending'), isNotNull(workflowTasks.timeoutAt), lte(workflowTasks.timeoutAt, now)));

  if (due.length === 0) return { processed: 0, reminded: 0, approved: 0, rejected: 0, escalated: 0 };

  // 按 instanceId 聚合，避免重复加载实例快照
  const instanceIds = [...new Set(due.map((t) => t.instanceId))];
  const insts = await db.select().from(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
  const instMap = new Map(insts.map((i) => [i.id, i] as const));

  let reminded = 0;
  let approved = 0;
  let rejected = 0;
  let escalated = 0;

  for (const task of due) {
    const inst = instMap.get(task.instanceId);
    if (!inst || inst.status !== 'running') continue;
    const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
    const flowData = snapshot?.flowData;
    const nodeCfg: WorkflowNodeConfig | undefined = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
    const cfg = nodeCfg?.timeout;
    if (!cfg || !cfg.enabled) {
      // 配置已被移除：清空 timeoutAt 防止重复扫描
      await db.update(workflowTasks).set({ timeoutAt: null })
        .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')));
      continue;
    }

    try {
      if (cfg.action === 'autoApprove') {
        await approveTaskCore(task, inst, '系统超时自动通过', SYSTEM_ACTOR);
        approved += 1;
      } else if (cfg.action === 'autoReject') {
        await rejectTaskCore(task, inst, '系统超时自动拒绝', SYSTEM_ACTOR);
        rejected += 1;
      } else {
        // action='remind'：累加提醒次数；耗尽后按 escalateAction 升级处理
        const nextCount = (task.timeoutRemindCount ?? 0) + 1;
        const maxRemind = cfg.remindCount ?? 3;
        const reachedMax = nextCount >= maxRemind;
        if (!reachedMax) {
          await db.update(workflowTasks)
            .set({ timeoutRemindCount: nextCount, timeoutAt: computeTimeoutAt(cfg, now) })
            .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')));
          logger.info('workflow task timeout remind', { taskId: task.id, instanceId: inst.id, nextCount, maxRemind });
          reminded += 1;
          continue;
        }

        // 提醒已耗尽 → 升级
        const escalate = cfg.escalateAction ?? 'none';
        if (escalate === 'autoApprove') {
          await db.update(workflowTasks).set({ timeoutRemindCount: nextCount, timeoutAt: null })
            .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')));
          await approveTaskCore(task, inst, '系统超时（提醒耗尽）自动通过', SYSTEM_ACTOR);
          approved += 1;
        } else if (escalate === 'autoReject') {
          await db.update(workflowTasks).set({ timeoutRemindCount: nextCount, timeoutAt: null })
            .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')));
          await rejectTaskCore(task, inst, '系统超时（提醒耗尽）自动拒绝', SYSTEM_ACTOR);
          rejected += 1;
        } else if (escalate === 'transferToManager') {
          const target = await resolveTransferFallbackTarget(task, cfg);
          if (target) {
            await systemTransferTaskToManager(task, inst, target.userId, computeTimeoutAt(cfg, now), `[系统超时] 提醒耗尽，自动转交给${target.reason}处理`);
            logger.info('workflow task timeout escalate transfer', { taskId: task.id, instanceId: inst.id, targetUserId: target.userId, reason: target.reason });
            escalated += 1;
          } else {
            const fallback = cfg.escalateFallbackAction ?? 'none';
            await db.update(workflowTasks).set({ timeoutRemindCount: nextCount, timeoutAt: null })
              .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')));
            if (fallback === 'autoApprove') {
              await approveTaskCore(task, inst, '系统超时（无人可转）自动通过', SYSTEM_ACTOR);
              approved += 1;
            } else if (fallback === 'autoReject') {
              await rejectTaskCore(task, inst, '系统超时（无人可转）自动拒绝', SYSTEM_ACTOR);
              rejected += 1;
            } else {
              logger.warn('workflow task timeout escalate: no transfer fallback target', { taskId: task.id, instanceId: inst.id, assigneeId: task.assigneeId });
            }
          }
        } else {
          // none：停止扫描，保持挂起
          await db.update(workflowTasks).set({ timeoutRemindCount: nextCount, timeoutAt: null })
            .where(and(eq(workflowTasks.id, task.id), eq(workflowTasks.status, 'pending')));
        }
      }
    } catch (err) {
      logger.error('processWorkflowTaskTimeouts: action failed', { err, taskId: task.id });
    }
  }

  return { processed: due.length, reminded, approved, rejected, escalated };
}
