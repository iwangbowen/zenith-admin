import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import { approveTaskCore } from '../../../services/workflow-instances.service';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobPermanentError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { isConflict, requireNumber } from './shared';

const ACTOR = { userId: 0, name: 'system:delay' } as const;

/**
 * delay_wake：延时节点到期唤醒。
 * 取代 workflow-resume.service.ts:resumeDelayTask（不再依赖 task.wakeAt 列）。
 * payload: { taskId }
 */
async function handle({ payload }: WorkflowJobContext): Promise<void> {
  let taskId: number;
  try {
    taskId = requireNumber(payload, 'taskId');
  } catch (err) {
    throw new WorkflowJobPermanentError(`delay_wake: ${(err as Error).message}`);
  }

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.nodeType !== 'delay' || task.status !== 'waiting') {
    throw new WorkflowJobSkip('delay 任务已不在等待状态');
  }
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') {
    throw new WorkflowJobSkip('实例不在运行中');
  }

  try {
    await approveTaskCore(task, inst, '延迟到期自动唤醒', ACTOR);
  } catch (err) {
    if (isConflict(err)) throw new WorkflowJobSkip('任务已被其它路径推进');
    throw err;
  }
}

registerJobHandler('delay_wake', handle);
