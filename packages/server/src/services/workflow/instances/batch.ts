// ─── 批量审批与跨实例批量操作（拆分自 workflow-instances.service.ts）───
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import type { WorkflowFlowData, WorkflowBatchActionResult } from '@zenith/shared';
import { findNextApproverSelectNodes } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../../lib/context';
import { urgeInstance } from './cc-urge';
import { withdrawInstance } from './lifecycle';
import { approveTask, rejectTask } from './task-actions';

/** 跨实例批量执行的最大并发组数（同实例内串行，避免行锁互等） */
const BATCH_GROUP_CONCURRENCY = 5;

interface BatchTaskPlan {
  /** 可执行的任务，按实例分组（组内保持入参顺序） */
  groups: Map<number, number[]>;
  /** 预检失败的结果（保留原因） */
  precheckFailures: Map<number, string>;
}

/**
 * 批量预载与预检：一次性查出本人名下的 pending 任务及其实例快照，
 * 消除逐条 2 次预查询的 N+1；返回按实例分组的执行计划。
 */
async function planBatchTasks(taskIds: number[], opts: { checkApproverSelect: boolean }): Promise<BatchTaskPlan> {
  const user = currentUser();
  const uniqueIds = [...new Set(taskIds)];
  const groups = new Map<number, number[]>();
  const precheckFailures = new Map<number, string>();
  if (uniqueIds.length === 0) return { groups, precheckFailures };

  const taskRows = await db
    .select({ id: workflowTasks.id, nodeKey: workflowTasks.nodeKey, instanceId: workflowTasks.instanceId })
    .from(workflowTasks)
    .where(and(
      inArray(workflowTasks.id, uniqueIds),
      eq(workflowTasks.assigneeId, user.userId),
      eq(workflowTasks.status, 'pending'),
    ));
  const taskById = new Map(taskRows.map((t) => [t.id, t]));

  let snapshotByInstance = new Map<number, WorkflowFlowData | undefined>();
  if (opts.checkApproverSelect && taskRows.length > 0) {
    const instanceIds = [...new Set(taskRows.map((t) => t.instanceId))];
    const instRows = await db
      .select({ id: workflowInstances.id, definitionSnapshot: workflowInstances.definitionSnapshot })
      .from(workflowInstances)
      .where(inArray(workflowInstances.id, instanceIds));
    snapshotByInstance = new Map(instRows.map((r) => [
      r.id,
      r.definitionSnapshot?.flowData ?? undefined,
    ]));
  }

  for (const taskId of taskIds) {
    if (groups.has(taskId) || precheckFailures.has(taskId)) continue; // 去重（重复 id 只处理一次）
    const task = taskById.get(taskId);
    if (!task) {
      precheckFailures.set(taskId, '任务不存在、无权操作或已处理');
      continue;
    }
    if (opts.checkApproverSelect) {
      // 批量审批无法逐个为「下一节点自选审批人」指定人选 —— 提前识别并跳过，提示单独审批
      const flowData = snapshotByInstance.get(task.instanceId);
      if (flowData && findNextApproverSelectNodes(flowData, task.nodeKey).length > 0) {
        precheckFailures.set(taskId, '需指定下一节点审批人，请单独审批');
        continue;
      }
    }
    const list = groups.get(task.instanceId) ?? [];
    list.push(taskId);
    groups.set(task.instanceId, list);
  }
  return { groups, precheckFailures };
}

/** 受限并发执行分组任务：组间并行（不同实例无锁竞争），组内串行（同实例行锁序列化） */
async function runGroupsWithLimit(groups: Array<() => Promise<void>>, limit: number): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, groups.length) }, async () => {
    while (cursor < groups.length) {
      const job = groups[cursor++];
      await job();
    }
  });
  await Promise.all(workers);
}

async function runBatchOnTasks(
  taskIds: number[],
  opts: { checkApproverSelect: boolean },
  action: (taskId: number) => Promise<void>,
  failMessage: string,
): Promise<WorkflowBatchActionResult[]> {
  const { groups, precheckFailures } = await planBatchTasks(taskIds, opts);
  const resultByTask = new Map<number, WorkflowBatchActionResult>();
  for (const [taskId, message] of precheckFailures) {
    resultByTask.set(taskId, { taskId, success: false, message });
  }
  const groupRunners = [...groups.values()].map((ids) => async () => {
    for (const taskId of ids) {
      try {
        await action(taskId);
        resultByTask.set(taskId, { taskId, success: true });
      } catch (err) {
        resultByTask.set(taskId, {
          taskId,
          success: false,
          message: err instanceof HTTPException ? err.message : failMessage,
        });
      }
    }
  });
  await runGroupsWithLimit(groupRunners, BATCH_GROUP_CONCURRENCY);
  // 按入参顺序返回（重复 id 复用同一结果）
  return taskIds.map((taskId) => resultByTask.get(taskId) ?? { taskId, success: false, message: failMessage });
}

export async function batchApproveTasks(taskIds: number[], comment?: string): Promise<WorkflowBatchActionResult[]> {
  return runBatchOnTasks(
    taskIds,
    { checkApproverSelect: true },
    async (taskId) => { await approveTask(taskId, comment); },
    '处理失败',
  );
}

export async function batchRejectTasks(taskIds: number[], comment: string): Promise<WorkflowBatchActionResult[]> {
  return runBatchOnTasks(
    taskIds,
    { checkApproverSelect: false },
    async (taskId) => { await rejectTask(taskId, comment); },
    '处理失败',
  );
}

export async function batchWithdrawInstances(instanceIds: number[], _comment?: string): Promise<import('@zenith/shared').WorkflowInstanceBatchActionResult[]> {
  const results: import('@zenith/shared').WorkflowInstanceBatchActionResult[] = [];
  for (const instanceId of instanceIds) {
    try {
      await withdrawInstance(instanceId);
      results.push({ instanceId, success: true });
    } catch (err) {
      results.push({ instanceId, success: false, message: err instanceof HTTPException ? err.message : '撤回失败' });
    }
  }
  return results;
}

export async function batchUrgeInstances(instanceIds: number[], message?: string): Promise<import('@zenith/shared').WorkflowInstanceBatchActionResult[]> {
  const results: import('@zenith/shared').WorkflowInstanceBatchActionResult[] = [];
  for (const instanceId of instanceIds) {
    try {
      const r = await urgeInstance(instanceId, message);
      results.push({ instanceId, success: true, message: r.message });
    } catch (err) {
      results.push({ instanceId, success: false, message: err instanceof HTTPException ? err.message : '催办失败' });
    }
  }
  return results;
}
