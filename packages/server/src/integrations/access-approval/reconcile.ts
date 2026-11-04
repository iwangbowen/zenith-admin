import { db } from '../../db';
import { taskTransaction } from '../../lib/task-center';
import { listUnsettledAccessApprovals, reconcilePendingAccessRequests } from '../../services/identity/public/access-approval';
import { listBusinessApprovalOutcomes, lockBusinessApproval, lastBusinessDecision } from '../../services/workflow/public/access-approval';
import { bridgeAccessWorkflowOutcome } from './bridge';

export async function reconcileAccessGovernance(): Promise<string> {
  const invalidated = await reconcilePendingAccessRequests();
  const requests = await listUnsettledAccessApprovals();
  const rows = (await listBusinessApprovalOutcomes(db, requests.flatMap(row => row.workflowInstanceId ? [row.workflowInstanceId] : [])))
    .filter(row => requests.some(request => request.workflowInstanceId === row.id && request.tenantId === row.tenantId));
  for (const row of rows) await taskTransaction(async tx => {
    const locked = await lockBusinessApproval(tx, row.id, row.tenantId);
    if (!locked) return;
    const approver = await lastBusinessDecision(tx, row.id, 'approved');
    await bridgeAccessWorkflowOutcome(tx, locked, approver?.assigneeId ?? null);
  });
  return `权限审批对账：终止 ${invalidated} 条失效申请，核对 ${rows.length} 条结束申请，授权由可靠任务发放`;
}
