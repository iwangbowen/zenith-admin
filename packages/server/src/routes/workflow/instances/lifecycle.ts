// ─── 实例生命周期：创建/撤回/取消/删除/草稿/重新提交 ───
import { workflowInstanceContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { createInstance, withdrawInstance, cancelInstance, deleteInstance, getInstanceForAdminAudit, getWorkflowInstanceBeforeAudit, updateInstanceDraft, submitDraftInstance, resubmitInstance } from '../../../services/workflow/workflow-instances.service';

export const createInstanceRoute = defineContractRoute(workflowInstanceContract.create, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:instance:create', audit: { description: '发起流程申请', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const body = c.req.valid('json');
    const r = await createInstance(body);
    return c.json(okBody(r, body.asDraft ? '草稿已保存' : '申请已提交'), 200);
  },
});

export const withdrawRoute = defineContractRoute(workflowInstanceContract.withdraw, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '撤回流程申请', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await withdrawInstance(id), '已撤回'), 200);
  },
});

export const cancelInstanceRoute = defineContractRoute(workflowInstanceContract.cancel, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '取消流程', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await cancelInstance(id), '已取消'), 200);
  },
});

export const deleteInstanceRoute = defineContractRoute(workflowInstanceContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:delete', audit: { description: '删除流程实例', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteInstance(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

export const updateDraftRoute = defineContractRoute(workflowInstanceContract.updateDraft, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '编辑流程草稿', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateInstanceDraft(id, c.req.valid('json')), '草稿已保存'), 200);
  },
});

export const submitDraftRoute = defineContractRoute(workflowInstanceContract.submitDraft, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '提交流程草稿', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await submitDraftInstance(id, body), '申请已提交'), 200);
  },
});

export const resubmitRoute = defineContractRoute(workflowInstanceContract.resubmit, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '重新提交流程', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await resubmitInstance(id), '已生成草稿'), 200);
  },
});
