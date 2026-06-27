import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import { resumeParentSubProcess, reconcileMultiSubProcess } from '../../../services/workflow-instances.service';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { requireNumber } from './shared';

const ACTOR = { userId: 0, name: 'system:subprocess-join' } as const;

/**
 * subprocess_join：子实例结束后唤醒/汇聚父 subProcess 任务。
 * 取代 subprocess-recovery 的 resume / multi-reconcile 分支。
 * payload: { parentTaskId }
 */
async function handle({ payload }: WorkflowJobContext): Promise<void> {
  let parentTaskId: number;
  try {
    parentTaskId = requireNumber(payload, 'parentTaskId');
  } catch (err) {
    throw new WorkflowJobPermanentError(`subprocess_join: ${(err as Error).message}`);
  }

  const [parentTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, parentTaskId)).limit(1);
  if (!parentTask || parentTask.nodeType !== 'subProcess' || parentTask.status !== 'waiting') {
    throw new WorkflowJobSkip('父子流程任务已不在等待状态');
  }

  // 多实例：基于实际子实例状态绝对重算汇聚（幂等，对健康父任务为 no-op）
  if (parentTask.subTotal != null) {
    await reconcileMultiSubProcess(parentTask.id, parentTask.instanceId, ACTOR);
    return;
  }

  // 单实例：找到已结束的子实例并唤醒父任务
  const [child] = await db.select().from(workflowInstances)
    .where(and(
      eq(workflowInstances.parentTaskId, parentTask.id),
      inArray(workflowInstances.status, ['approved', 'rejected']),
    ))
    .orderBy(workflowInstances.id)
    .limit(1);
  if (!child) throw new WorkflowJobSkip('尚无已结束子实例，等待子流程完成');

  await resumeParentSubProcess(child, child.status as 'approved' | 'rejected', ACTOR);
}

registerJobHandler('subprocess_join', handle);
