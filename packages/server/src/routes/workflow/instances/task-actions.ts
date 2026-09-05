// ─── 审批动作：同意/拒绝/下一步审批人 ───
import { workflowTaskContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { approveTask, rejectTask, getWorkflowTaskBeforeAudit, listTaskSelectableNextApprovers } from '../../../services/workflow/workflow-instances.service';

export const approveRoute = defineContractRoute(workflowTaskContract.approve, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '审批通过', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment, attachments, selectedNextApprovers, signature, formUpdates } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await approveTask(taskId, comment, attachments, selectedNextApprovers, signature, formUpdates);
    return c.json(okBody(result.instance, result.message), 200);
  },
});

export const selectableNextApproversRoute = defineContractRoute(workflowTaskContract.selectableNextApprovers, {
  middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
  handler: async (c) => c.json(okBody(await listTaskSelectableNextApprovers(c.req.valid('param').taskId)), 200),
});

export const rejectRoute = defineContractRoute(workflowTaskContract.reject, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '审批驳回', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await rejectTask(taskId, comment, attachments);
    return c.json(okBody(r.instance, r.message), 200);
  },
});
