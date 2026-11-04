/** Identity-owned application operations used by the access approval integration. */
export { previewAccessWorkflowFormData, normalizeAccessWorkflowFormData, applyApprovedAccessRequest, listUnsettledAccessApprovals } from '../access-governance.service';
export { verifyAccessApprovalMfa, assertAccessApprovalInTransaction, assertAccessTaskAssigneeInTransaction } from '../access-approval.service';
export { lockIdentityAuthority } from '../authority-write.service';
export { assertNoOverlappingAccessRequest } from '../access-reservations.service';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { ACCESS_REQUEST_BIZ_TYPE } from '@zenith/shared/identity';
import type { DbTransaction } from '../../../db/types';
import { identityAccessRequestItems, identityAccessRequests } from '../../../db/schema';
import { exactTenantCondition } from '../../../lib/tenant';
import { parseDateTimeInput } from '../../../lib/datetime';
import { persistSystemAsyncTask } from '../../../lib/task-center';
import { notifyWithin } from '../../messaging/notification-outbox.service';
import { resolveUserNames } from '../../../lib/user-nicknames';
import { normalizeAccessWorkflowFormData } from '../access-governance.service';
import { lockIdentityAuthority } from '../authority-write.service';
import { assertNoOverlappingAccessRequest } from '../access-reservations.service';

type NormalizedAccessForm = Awaited<ReturnType<typeof normalizeAccessWorkflowFormData>>;
type InstanceIdentity = { id: number; tenantId: number | null; initiatorId: number; formData: unknown };

/** 仅接收已由权限域归一化的表单，与流程和权限预约共用提交事务。 */
export async function attachAccessRequestToWorkflow(executor: DbTransaction, instance: InstanceIdentity): Promise<{ bizType: string; bizId: string }> {
  const form = instance.formData as NormalizedAccessForm;
  if (!Array.isArray(form?.permissionItems) || form.permissionItems.length === 0 || form.targetUserId !== instance.initiatorId) {
    throw new HTTPException(409, { message: '权限申请缺少有效的服务端审批快照' });
  }
  await lockIdentityAuthority(executor, instance.tenantId);
  await normalizeAccessWorkflowFormData(form.requestInput, { userId: instance.initiatorId, tenantId: instance.tenantId, username: form.targetUserName }, executor);
  const startsAt = parseDateTimeInput(form.startsAt);
  const expiresAt = form.expiresAt === null ? null : parseDateTimeInput(form.expiresAt);
  if (!startsAt || (form.validityMode === 'limited' && !expiresAt)) throw new HTTPException(400, { message: '权限申请有效期无效' });
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`identity-access:${instance.tenantId ?? 'platform'}:${instance.initiatorId}`}, 0))`);
  const existing = await executor.query.identityAccessRequests.findFirst({
    where: and(eq(identityAccessRequests.workflowInstanceId, instance.id), exactTenantCondition(identityAccessRequests.tenantId, instance.tenantId)),
    columns: { id: true },
  });
  if (existing) throw new HTTPException(409, { message: '该权限申请已提交，请重新发起新的申请' });
  await assertNoOverlappingAccessRequest({ targetUserId: instance.initiatorId, tenantId: instance.tenantId, startsAt, expiresAt, items: form.permissionItems }, executor);
  const [request] = await executor.insert(identityAccessRequests).values({
    tenantId: instance.tenantId,
    applicantUserId: instance.initiatorId,
    targetUserId: instance.initiatorId,
    requestType: form.requestType,
    status: 'pending',
    reason: form.reason,
    startsAt,
    expiresAt,
    riskLevel: form.riskLevel,
    policySnapshot: form.policySnapshot,
    approvalPlan: form.approvalPlan,
    workflowInstanceId: instance.id,
  }).returning({ id: identityAccessRequests.id });
  await executor.insert(identityAccessRequestItems).values(form.permissionItems.map((item) => ({ requestId: request.id, ...item })));
  await notifyWithin(executor, 'identity.access.requested', {
    recipients: [{ type: 'user', id: instance.initiatorId }], vars: { requestId: request.id, applicantName: form.targetUserName, targetName: form.targetUserName, riskLevel: form.riskLabel },
    tenantId: instance.tenantId, link: `/workflow/instance/${instance.id}`, dedupeKey: `identity-access-requested:${request.id}`,
  });
  return { bizType: ACCESS_REQUEST_BIZ_TYPE, bizId: String(request.id) };
}

export async function recordAccessWorkflowOutcome(
  executor: DbTransaction,
  instance: { id: number; tenantId: number | null; bizType?: string | null; bizId?: string | null; status: string },
  actorId: number | null,
  rejectionReason?: string | null,
): Promise<void> {
  if (instance.bizType !== ACCESS_REQUEST_BIZ_TYPE) return;
  const requestId = Number(instance.bizId);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new Error('权限流程缺少业务申请关联');
  const where = and(eq(identityAccessRequests.id, requestId), eq(identityAccessRequests.workflowInstanceId, instance.id), exactTenantCondition(identityAccessRequests.tenantId, instance.tenantId));
  const [request] = await executor.select({ status: identityAccessRequests.status, approvedAt: identityAccessRequests.approvedAt, provisionStatus: identityAccessRequests.provisionStatus }).from(identityAccessRequests).where(where).for('update').limit(1);
  if (!request) throw new Error('权限流程关联的申请不存在');
  if (instance.status === 'approved' && ['pending', 'approved'].includes(request.status) && !['succeeded', 'failed', 'terminated'].includes(request.provisionStatus)) {
    if (request.status === 'pending' || request.provisionStatus === 'not_started') await executor.update(identityAccessRequests).set({ status: 'approved', provisionStatus: 'pending', approvedAt: request.approvedAt ?? new Date(), failureReason: null }).where(where);
    await persistSystemAsyncTask(executor, {
      taskType: 'identity-access-grant-apply',
      payload: { requestId, workflowInstanceId: instance.id, approvedBy: actorId },
      idempotencyKey: `identity-access-apply:${requestId}`,
    }, instance.tenantId);
  } else if (['rejected', 'withdrawn', 'cancelled'].includes(instance.status)) {
    await executor.update(identityAccessRequests).set({
      status: instance.status === 'rejected' ? 'rejected' : 'cancelled',
      provisionStatus: 'terminated',
      ...(instance.status === 'rejected' ? { rejectedAt: new Date() } : {}),
    }).where(and(where, inArray(identityAccessRequests.status, ['pending'])));
    if (instance.status === 'rejected' && request.status === 'pending') {
      const detail = await executor.query.identityAccessRequests.findFirst({ where, columns: { targetUserId: true, applicantUserId: true } });
      if (detail) {
        const names = await resolveUserNames([detail.targetUserId], executor);
        await notifyWithin(executor, 'identity.access.rejected', { recipients: [{ type: 'user', id: detail.applicantUserId }], vars: { requestId, targetName: names.get(detail.targetUserId) ?? `用户 ${detail.targetUserId}`, reason: rejectionReason ?? '审批未通过' }, tenantId: instance.tenantId, link: `/workflow/instance/${instance.id}`, dedupeKey: `identity-access-rejected:${requestId}` });
      }
    }
  }
}

export { reconcilePendingAccessRequests } from '../access-request-lifecycle.service';
