import { eq } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowTasks, workflowInstances } from '../../../db/schema';
import { maybeSpawnSubProcessChild, handleNodeExecutionError } from '../../../services/workflow/workflow-instances.service';
import { registerJobHandler } from '../registry';
import { WorkflowJobSkip, WorkflowJobPermanentError, WorkflowJobError } from '../errors';
import type { WorkflowJobContext } from '../types';
import { requireNumber } from './shared';

const ACTOR = { userId: 0, name: 'system:subprocess-spawn' } as const;

/**
 * subprocess_spawn：为 subProcess 节点发起子实例（含多实例展开）。
 * 取代 subprocess-recovery 的 spawn 扫描分支；maybeSpawnSubProcessChild 内部幂等。
 * 最终失败时走统一失败策略（handleNodeExecutionError），与 trigger/external 一致。
 * payload: { taskId }
 */
async function handle({ payload, attempt, job }: WorkflowJobContext): Promise<void> {
  let taskId: number;
  try {
    taskId = requireNumber(payload, 'taskId');
  } catch (err) {
    throw new WorkflowJobPermanentError(`subprocess_spawn: ${(err as Error).message}`);
  }

  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task || task.nodeType !== 'subProcess') {
    throw new WorkflowJobSkip('子流程任务不存在或类型不符');
  }
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') throw new WorkflowJobSkip('父实例不在运行中');

  try {
    await maybeSpawnSubProcessChild(inst, task, ACTOR);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (attempt < job.maxAttempts) throw new WorkflowJobError(errorMessage);
    await handleNodeExecutionError({ instance: inst, task, nodeKey: task.nodeKey, nodeName: task.nodeName, errorMessage, actor: ACTOR });
    throw new WorkflowJobError(errorMessage, { permanent: true });
  }
}

registerJobHandler('subprocess_spawn', handle);
