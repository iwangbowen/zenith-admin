import { and, asc, eq, gt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { identityAccessRequests } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import { businessApprovalTransaction, lockBusinessApproval, cancelBusinessApproval } from '../workflow/public/access-approval';
import { assertAccessSnapshotDuration } from './access-policy.service';
import { resolveAccessApprovalPlan } from './access-approval.service';
import { lockIdentityAuthority } from './authority-write.service';

/** Invalid policy/organization snapshots end the request and release its reservation. */
export async function reconcilePendingAccessRequests(): Promise<number> {
  let cursor = 0;
  let cancelled = 0;
  while (true) {
    const rows = await db.select({ id: identityAccessRequests.id, workflowInstanceId: identityAccessRequests.workflowInstanceId, tenantId: identityAccessRequests.tenantId })
      .from(identityAccessRequests).where(and(eq(identityAccessRequests.status, 'pending'), gt(identityAccessRequests.id, cursor))).orderBy(asc(identityAccessRequests.id)).limit(200);
    if (!rows.length) return cancelled;
    for (const row of rows) {
      cursor = row.id;
      if (!row.workflowInstanceId) continue;
      await businessApprovalTransaction(async tx => {
        await lockBusinessApproval(tx, row.workflowInstanceId!, row.tenantId);
        const where = and(eq(identityAccessRequests.id, row.id), exactTenantCondition(identityAccessRequests.tenantId, row.tenantId));
        const [request] = await tx.select().from(identityAccessRequests).where(where).for('update').limit(1);
        if (!request || request.status !== 'pending') return;
        await lockIdentityAuthority(tx, row.tenantId);
        try {
          await assertAccessSnapshotDuration(request.policySnapshot, request.startsAt, request.expiresAt, row.tenantId, tx);
          const current = await resolveAccessApprovalPlan(request.targetUserId, row.tenantId, request.approvalPlan.approvalPolicy, request.approvalPlan.mfaRequired, tx);
          if (JSON.stringify(current.steps.map(step => [step.nodeKey, step.userId])) !== JSON.stringify(request.approvalPlan.steps.map(step => [step.nodeKey, step.userId]))) {
            throw new HTTPException(409, { message: '审批人或组织关系已变化，请按最新审批计划重新申请' });
          }
        } catch (error) {
          if (!(error instanceof HTTPException) || error.status >= 500) throw error;
          const reason = `权限申请已失效：${error.message}`;
          const ended = await cancelBusinessApproval(tx, row.workflowInstanceId!, row.tenantId, reason);
          if (!ended) return;
          await tx.update(identityAccessRequests).set({ status: 'cancelled', provisionStatus: 'terminated', failureReason: reason.slice(0, 1000) }).where(where);
          cancelled++;
        }
      });
    }
  }
}
