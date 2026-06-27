import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import { maybeSpawnSubProcessChild } from '../../../services/workflow-instances.service';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { requireNumber } from './shared';

const ACTOR = { userId: 0, name: 'system:subprocess-spawn' } as const;

/**
 * subprocess_spawn：为 subProcess 节点发起子实例（含多实例展开）。
 * 取代 subprocess-recovery 的 spawn 扫描分支；maybeSpawnSubProcessChild 内部幂等。
 * payload: { taskId }
 */
async function handle({ payload }: WorkflowJobContext): Promise<void> {
  let taskId: number;
  try {
    taskId = requireNumber(payload, 'taskId');
  } catch (err) {
    throw new WorkflowJobPermanentError(`subprocess_spawn: ${(err as Error).message}`);
  }

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.nodeType !== 'subProcess' || task.status !== 'waiting') {
    throw new WorkflowJobSkip('子流程任务已不在等待状态');
  }
  // 幂等：已存在子实例则视为已起步
  const [existingChild] = await db.select({ id: workflowInstances.id }).from(workflowInstances)
    .where(eq(workflowInstances.parentTaskId, task.id)).limit(1);
  if (existingChild) throw new WorkflowJobSkip('子实例已存在，跳过重复发起');

  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') throw new WorkflowJobSkip('父实例不在运行中');

  await maybeSpawnSubProcessChild(inst, task, ACTOR);
}

registerJobHandler('subprocess_spawn', handle);
