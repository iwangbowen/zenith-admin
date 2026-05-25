import { eq } from 'drizzle-orm';
import { db } from '../db';
import { workflowTasks, workflowInstances } from '../db/schema';
import { approveTaskCore } from './workflow-instances.service';
import logger from '../lib/logger';

/**
 * 唤醒指定的 delay 任务：将其标记为 approved 并推进流程。
 * 由 delay-scheduler 在 wake_at 到达时调用，亦可被运维手动触发。
 */
export async function resumeDelayTask(taskId: number): Promise<void> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, taskId)).limit(1);
  if (!task) {
    logger.warn(`resumeDelayTask: task ${taskId} not found`);
    return;
  }
  if (task.nodeType !== 'delay' || task.status !== 'waiting') {
    return;
  }
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst || inst.status !== 'running') {
    return;
  }
  await approveTaskCore(task, inst, '延迟到期自动唤醒', { userId: 0, name: 'system:delay' });
}
