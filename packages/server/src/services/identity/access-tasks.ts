import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { identityAccessRequests, identityAccessReviewCampaigns } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import { registerTaskHandler, TaskCancelledError, TaskNonRetryableError } from '../../lib/task-center';
import { applyApprovedAccessRequest } from './access-governance.service';
import { buildAccessReviewCampaign } from './access-review.service';

function positiveId(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
export function registerAccessTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'identity-access-grant-apply', title: '权限授权发放', module: '权限治理', maxAttempts: 5, retryDelayMs: 30_000,
    async run(ctx) {
      const { requestId, workflowInstanceId, approvedBy } = ctx.payload;
      if (!positiveId(requestId) || !positiveId(workflowInstanceId)) throw new TaskNonRetryableError('权限授权发放任务缺少有效申请关联');
      try {
        const grant = await applyApprovedAccessRequest(requestId, { workflowInstanceId, tenantId: ctx.tenantId, approvedBy: positiveId(approvedBy) ? approvedBy : null });
        return { requestId, grantId: grant?.id ?? null };
      } catch (error) {
        if (error instanceof HTTPException && error.status >= 400 && error.status < 500) throw new TaskCancelledError(error.message);
        throw error;
      }
    },
    async settleInTransaction(tx, task) {
      const requestId = task.payload?.requestId;
      if (!positiveId(requestId)) return;
      const provisionStatus = task.cancelRequested || task.status === 'cancelled' ? 'terminated' : task.status === 'failed' ? 'failed' : task.status === 'running' ? 'running' : 'pending';
      if (task.status === 'success') return;
      await tx.update(identityAccessRequests).set({ provisionStatus, failureReason: task.errorMessage ?? (provisionStatus === 'terminated' ? '授权发放任务已取消' : null) })
        .where(and(eq(identityAccessRequests.id, requestId), exactTenantCondition(identityAccessRequests.tenantId, task.tenantId), eq(identityAccessRequests.status, 'approved'),
          inArray(identityAccessRequests.provisionStatus, ['not_started', 'pending', 'running', 'failed'])));
    },
  });
  registerTaskHandler({
    taskType: 'identity-access-review-build', title: '权限复核准备', module: '权限治理', maxAttempts: 5, retryDelayMs: 30_000,
    async run(ctx) {
      const { campaignId } = ctx.payload;
      if (!positiveId(campaignId)) throw new TaskNonRetryableError('复核准备任务缺少有效批次关联');
      await buildAccessReviewCampaign(campaignId, ctx.tenantId);
      return { campaignId };
    },
    async settleInTransaction(tx, task) {
      const campaignId = task.payload?.campaignId;
      if (!positiveId(campaignId) || task.status === 'success') return;
      const stopped = task.cancelRequested || task.status === 'failed' || task.status === 'cancelled';
      await tx.update(identityAccessReviewCampaigns).set({ status: stopped ? 'failed' : 'preparing', failureReason: stopped ? task.errorMessage ?? '复核准备任务已取消，可重试继续准备' : null })
        .where(and(eq(identityAccessReviewCampaigns.id, campaignId), exactTenantCondition(identityAccessReviewCampaigns.tenantId, task.tenantId), inArray(identityAccessReviewCampaigns.status, ['preparing', 'failed'])));
    },
  });
}
