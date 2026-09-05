import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowTasks, workflowInstances } from '../../db/schema';
import { approveTaskCore } from './workflow-instances.service';
import { HTTPException } from 'hono/http-exception';

/**
 * 触发器回调唤醒：通过 externalCallbackId 找到等待中的 trigger 任务，标记为 approved 并推进流程。
 * 供触发器回调路由（`workflowTriggerCallbackContract`）调用。
 */
export async function resumeTriggerTask(
  callbackId: string,
  comment: string | undefined,
  callerName: string,
  payload?: Record<string, unknown>,
): Promise<{ instanceId: number; nodeKey: string }> {
  const [task] = await db.select().from(workflowTasks).where(eq(workflowTasks.externalCallbackId, callbackId)).limit(1);
  if (!task) throw new HTTPException(404, { message: '回调任务不存在' });
  if (task.nodeType !== 'trigger') throw new HTTPException(400, { message: '该回调不属于触发器任务' });
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId)).limit(1);
  if (!inst) throw new HTTPException(404, { message: '流程实例不存在' });
  if (task.status === 'approved') return { instanceId: inst.id, nodeKey: task.nodeKey };
  if (task.status !== 'waiting') throw new HTTPException(409, { message: '回调任务已处理' });
  if (inst.status !== 'running') throw new HTTPException(400, { message: '流程实例不在进行中' });
  try {
    let instForApprove = inst;
    if (payload && Object.keys(payload).length > 0) {
      const [updatedInst] = await db.transaction(async (tx) => {
        const [locked] = await tx.select({ formData: workflowInstances.formData })
          .from(workflowInstances)
          .where(eq(workflowInstances.id, inst.id))
          .for('update')
          .limit(1);
        const nextFormData = { ...((locked?.formData ?? inst.formData ?? {}) as Record<string, unknown>), ...payload };
        return tx.update(workflowInstances)
          .set({ formData: nextFormData })
          .where(eq(workflowInstances.id, inst.id))
          .returning();
      });
      if (updatedInst) instForApprove = updatedInst;
    }
    await approveTaskCore(task, instForApprove, comment ?? `触发器回调：${callerName}`, { userId: 0, name: `trigger:${callerName}` });
  } catch (err) {
    if (err instanceof HTTPException && err.status === 409) {
      const [freshTask] = await db.select().from(workflowTasks).where(eq(workflowTasks.id, task.id)).limit(1);
      if (freshTask?.status === 'approved') return { instanceId: inst.id, nodeKey: task.nodeKey };
    }
    throw err;
  }
  return { instanceId: inst.id, nodeKey: task.nodeKey };
}
