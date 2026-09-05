// ─── 管理员强制操作与令牌运维 ───
import { workflowInstanceOpsContract, workflowTaskContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { skipStuckToken, replayFromToken, batchSkipStuckTokens, getInstanceForAdminAudit, getWorkflowTaskBeforeAudit, getWorkflowTaskForAdminAudit, jumpInstance, reassignTask, recallTask, suspendInstance, resumeInstance, previewHandover, handoverTasks } from '../../../services/workflow/workflow-instances.service';

export const tokenSkipRoute = defineContractRoute(workflowInstanceOpsContract.skipToken, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor', audit: { description: '跳过卡死执行 Token', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await skipStuckToken(c.req.valid('param').id, c.req.valid('json').reason), '已跳过并推进'), 200),
});

export const tokenReplayRoute = defineContractRoute(workflowInstanceOpsContract.replayToken, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '从执行 Token 重放流程', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await replayFromToken(c.req.valid('param').id, c.req.valid('json').reason), '已从该节点重放'), 200),
});

export const batchSkipStuckRoute = defineContractRoute(workflowInstanceOpsContract.batchSkipStuck, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor', audit: { description: '批量推进卡死实例', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const res = await batchSkipStuckTokens(c.req.valid('json'));
    return c.json(okBody(res, `已推进 ${res.success}/${res.total} 个实例`), 200);
  },
});

export const jumpInstanceRoute = defineContractRoute(workflowInstanceOpsContract.jump, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '强制跳转流程节点', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { targetNodeKey, comment } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await jumpInstance(id, targetNodeKey, comment), '已跳转'), 200);
  },
});

export const reassignRoute = defineContractRoute(workflowTaskContract.reassign, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '改派审批处理人', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment } = c.req.valid('json');
    const before = await getWorkflowTaskForAdminAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const row = await reassignTask(taskId, targetUserId, comment);
    const after = await getWorkflowTaskForAdminAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(row, '已改派'), 200);
  },
});

export const recallRoute = defineContractRoute(workflowTaskContract.recall, {
  middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '撤回已办', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await recallTask(taskId, body.comment), '已撤回'), 200);
  },
});

export const suspendInstanceRoute = defineContractRoute(workflowInstanceOpsContract.suspend, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '挂起流程实例', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await suspendInstance(id, reason), '已挂起，计时已冻结'), 200);
  },
});

export const resumeInstanceRoute = defineContractRoute(workflowInstanceOpsContract.resume, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '恢复挂起流程实例', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await resumeInstance(id), '已恢复流转，计时按剩余时长续跑'), 200);
  },
});

export const handoverPreviewRoute = defineContractRoute(workflowTaskContract.handoverPreview, {
  middleware: [authMiddleware, guard({ permission: 'workflow:task:handover' })] as const,
  handler: async (c) => c.json(okBody(await previewHandover(c.req.valid('query').fromUserId)), 200),
});

export const handoverRoute = defineContractRoute(workflowTaskContract.handover, {
  middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handover', audit: { description: '离职交接待办', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const body = c.req.valid('json');
    const res = await handoverTasks(body);
    setAuditAfterData(c, { fromUserId: body.fromUserId, toUserId: body.toUserId, ...res, results: undefined });
    return c.json(okBody(res, `已交接 ${res.succeeded}/${res.taskTotal} 条待办`), 200);
  },
});
