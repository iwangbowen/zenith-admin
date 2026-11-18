import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { workflowCompensations, workflowNodeActivations, workflowTasks } from '../../../db/schema';
import { addCompensationLog } from '../workflow-compensations.service';
import type { DbExecutor } from '../../../db/types';

/** System results have no votes. Called under the instance lock, before advancing its token. */
export async function settleSystemActivationOutcome(tx: DbExecutor, task: typeof workflowTasks.$inferSelect, outcome: 'approved' | 'rejected', reason?: string) {
  if (task.taskKind !== 'system' || task.slotId != null || !task.activationId) throw new HTTPException(409, { message: '系统任务身份不匹配' });
  const [activation] = await tx.select().from(workflowNodeActivations).where(and(eq(workflowNodeActivations.id, task.activationId), eq(workflowNodeActivations.instanceId, task.instanceId))).limit(1);
  if (!activation || activation.status !== 'active' || (activation.kind !== 'system' && activation.kind !== 'repair')) throw new HTTPException(409, { message: '系统节点轮次已结束或身份不匹配' });
  if (outcome === 'rejected') await tx.update(workflowNodeActivations).set({ status: 'rejected', settledAt: new Date(), settlementReason: reason ?? '系统节点拒绝' }).where(eq(workflowNodeActivations.id, activation.id));
  if (activation.kind === 'repair') {
    const tickets = await tx.update(workflowCompensations).set({ status: outcome === 'approved' ? 'resolved' : 'terminated', resolution: reason ?? '修复任务已处理', resolvedAt: new Date() })
      .where(and(eq(workflowCompensations.repairActivationId, activation.id), eq(workflowCompensations.status, 'pending'))).returning();
    for (const ticket of tickets) await addCompensationLog(tx, { compensationId: ticket.id, action: outcome === 'approved' ? 'resume' : 'terminate', note: reason ?? '修复任务已处理', tenantId: ticket.tenantId });
  }
  return { completed: outcome === 'approved', failed: outcome === 'rejected' };
}
