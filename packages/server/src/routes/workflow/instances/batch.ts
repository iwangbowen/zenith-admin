// ─── 批量操作（含审计快照聚合）───
import { workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getWorkflowInstanceBeforeAudit, getWorkflowTaskBeforeAudit, batchApproveTasks, batchRejectTasks, batchWithdrawInstances, batchUrgeInstances } from '../../../services/workflow/workflow-instances.service';

export const compactAuditData = <T>(items: Array<T | null | undefined>) =>
  items.filter((item): item is T => item != null);

export const batchApproveRoute = defineContractRoute(workflowTaskContract.batchApprove, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '批量审批通过', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskIds, comment } = c.req.valid('json');
    const before = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (before.length > 0) setAuditBeforeData(c, before);
    const results = await batchApproveTasks(taskIds, comment);
    const after = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (after.length > 0) setAuditAfterData(c, after);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

export const batchRejectRoute = defineContractRoute(workflowTaskContract.batchReject, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '批量审批驳回', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskIds, comment } = c.req.valid('json');
    const before = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (before.length > 0) setAuditBeforeData(c, before);
    const results = await batchRejectTasks(taskIds, comment);
    const after = compactAuditData(await Promise.all(taskIds.map((id) => getWorkflowTaskBeforeAudit(id))));
    if (after.length > 0) setAuditAfterData(c, after);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

export const batchWithdrawRoute = defineContractRoute(workflowInstanceContract.batchWithdraw, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '批量撤回流程', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { instanceIds, comment } = c.req.valid('json');
    const before = compactAuditData(await Promise.all(instanceIds.map((id) => getWorkflowInstanceBeforeAudit(id))));
    if (before.length > 0) setAuditBeforeData(c, before);
    const results = await batchWithdrawInstances(instanceIds, comment);
    const after = compactAuditData(await Promise.all(instanceIds.map((id) => getWorkflowInstanceBeforeAudit(id))));
    if (after.length > 0) setAuditAfterData(c, after);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});

export const batchUrgeRoute = defineContractRoute(workflowInstanceContract.batchUrge, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '批量催办流程', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { instanceIds, message } = c.req.valid('json');
    const results = await batchUrgeInstances(instanceIds, message);
    const succeeded = results.filter((r) => r.success).length;
    return c.json(okBody({ succeeded, failed: results.length - succeeded, results }, `成功 ${succeeded} 条，失败 ${results.length - succeeded} 条`), 200);
  },
});
