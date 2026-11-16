import { and, desc, eq, inArray } from 'drizzle-orm';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import type { DbExecutor, DbTransaction } from '../../../db/types';
import { exactTenantCondition } from '../../../lib/tenant';
import { workflowTransaction } from '../../../lib/workflow-jobs/lease';

const instanceColumns = { id: workflowInstances.id, tenantId: workflowInstances.tenantId, bizType: workflowInstances.bizType,
  bizId: workflowInstances.bizId, status: workflowInstances.status, initiatorId: workflowInstances.initiatorId };

/** Internal application boundary: tenant and business reference always originate from an authorized business row. */
export async function lockBusinessApproval(tx: DbTransaction, id: number, tenantId: number | null) {
  const [instance] = await tx.select(instanceColumns).from(workflowInstances)
    .where(and(eq(workflowInstances.id, id), exactTenantCondition(workflowInstances.tenantId, tenantId))).for('update').limit(1);
  return instance;
}
export async function requireApprovedBusiness(tx: DbTransaction, id: number, tenantId: number | null, bizType: string, bizId: string): Promise<void> {
  const instance = await lockBusinessApproval(tx, id, tenantId);
  if (instance?.status !== 'approved' || instance.bizType !== bizType || instance.bizId !== bizId) throw new Error('权限申请尚未获得有效的流程批准');
}
export async function listBusinessApprovalOutcomes(executor: DbExecutor, ids: readonly number[]) {
  if (!ids.length) return [];
  return executor.select(instanceColumns).from(workflowInstances).where(and(inArray(workflowInstances.id, [...ids]),
    inArray(workflowInstances.status, ['approved', 'rejected', 'withdrawn', 'cancelled'])));
}
export async function lastBusinessDecision(executor: DbExecutor, instanceId: number, status: 'approved' | 'rejected') {
  return executor.query.workflowTasks.findFirst({ where: and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, status)),
    columns: { assigneeId: true, comment: true }, orderBy: [desc(workflowTasks.actionAt), desc(workflowTasks.id)] });
}
export async function cancelBusinessApproval(tx: DbTransaction, id: number, tenantId: number | null, reason: string) {
  const { cancelWorkflowInstanceInTransaction } = await import('../instances/lifecycle');
  return cancelWorkflowInstanceInTransaction(tx, id, tenantId, undefined, reason);
}
/** Workflow commands retain their queue pickup and transaction-effect semantics. */
export const businessApprovalTransaction = workflowTransaction;

/** 权限业务结果沿用精确实例的参与关系、租户和字段查看规则。 */
export async function requireAccessWorkflowViewer(id: number, bizType: string, bizId: string) {
  const { requireBusinessApprovalInstance } = await import('../workflow-business-context.service');
  return requireBusinessApprovalInstance(id, bizType, bizId);
}

/** 调用方先授权业务记录，仅返回对应流程的只读上下文。 */
export async function getAccessBusinessWorkflow(id: number, bizType: string, bizId: string) {
  const { getBusinessInstanceDetail } = await import('../instances/queries');
  return getBusinessInstanceDetail(id, bizType, bizId);
}
