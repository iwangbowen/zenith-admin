import { and, eq, lte, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db';
import { workflowTasks, workflowInstances } from '../db/schema';
import { approveTaskCore, rejectTaskCore } from '../services/workflow-instances.service';
import { computeTimeoutAt } from './workflow-timeout';
import type { WorkflowFlowData, WorkflowNodeConfig } from '@zenith/shared';
import logger from './logger';

const SYSTEM_ACTOR = { userId: 0, name: 'system:timeout' } as const;

/**
 * 扫描所有已超时的 pending 审批任务并执行相应动作。
 * 由 cron 调度器周期性触发（建议每 1-5 分钟）。
 */
export async function processWorkflowTaskTimeouts(): Promise<{ processed: number; reminded: number; approved: number; rejected: number }> {
  const now = new Date();
  const due = await db.select()
    .from(workflowTasks)
    .where(and(eq(workflowTasks.status, 'pending'), isNotNull(workflowTasks.timeoutAt), lte(workflowTasks.timeoutAt, now)));

  if (due.length === 0) return { processed: 0, reminded: 0, approved: 0, rejected: 0 };

  // 按 instanceId 聚合，避免重复加载实例快照
  const instanceIds = [...new Set(due.map((t) => t.instanceId))];
  const insts = await db.select().from(workflowInstances).where(inArray(workflowInstances.id, instanceIds));
  const instMap = new Map(insts.map((i) => [i.id, i] as const));

  let reminded = 0;
  let approved = 0;
  let rejected = 0;

  for (const task of due) {
    const inst = instMap.get(task.instanceId);
    if (!inst || inst.status !== 'running') continue;
    const snapshot = inst.definitionSnapshot as { flowData?: WorkflowFlowData } | null;
    const flowData = snapshot?.flowData;
    const nodeCfg: WorkflowNodeConfig | undefined = flowData?.nodes.find((n) => n.data.key === task.nodeKey)?.data;
    const cfg = nodeCfg?.timeout;
    if (!cfg || !cfg.enabled) {
      // 配置已被移除：清空 timeoutAt 防止重复扫描
      await db.update(workflowTasks).set({ timeoutAt: null }).where(eq(workflowTasks.id, task.id));
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
        const nextCount = (task.timeoutRemindCount ?? 0) + 1;
        const maxRemind = cfg.remindCount ?? 3;
        const reachedMax = nextCount >= maxRemind;
        const nextTimeoutAt = reachedMax ? null : computeTimeoutAt(cfg, now);
        await db.update(workflowTasks)
          .set({ timeoutRemindCount: nextCount, timeoutAt: nextTimeoutAt })
          .where(eq(workflowTasks.id, task.id));
        logger.info({ taskId: task.id, instanceId: inst.id, nextCount, maxRemind }, 'workflow task timeout remind');
        reminded += 1;
      }
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'processWorkflowTaskTimeouts: action failed');
    }
  }

  return { processed: due.length, reminded, approved, rejected };
}
