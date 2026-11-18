import { redactWorkflowSignatureImages } from '../../../services/workflow/instances/signature-audit';
import { previewBatchSkipStuckTokens } from '../../../services/workflow/instances/admin-ops';
// ─── 管理员强制操作与令牌运维 ───
import { workflowInstanceOpsContract, workflowTaskContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { skipStuckToken, replayFromToken, batchSkipStuckTokens, getInstanceForAdminAudit, getWorkflowTaskBeforeAudit, getWorkflowTaskForAdminAudit, jumpInstance, reassignTask, recallTask, suspendInstance, resumeInstance, previewHandover, handoverTasks } from '../../../services/workflow/workflow-instances.service';

export const tokenSkipRoute = defineContractRoute(workflowInstanceOpsContract.skipToken, {
  handler: async (c) => {
    const after = await skipStuckToken(c.req.valid('param').id, c.req.valid('json').reason, c.req.valid('json').previewToken);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已跳过并推进'), 200);
  },
});

export const tokenReplayRoute = defineContractRoute(workflowInstanceOpsContract.replayToken, {
  handler: async (c) => {
    const after = await replayFromToken(c.req.valid('param').id, c.req.valid('json').reason, c.req.valid('json').previewToken);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已从该节点重放'), 200);
  },
});

export const batchSkipStuckRoute = defineContractRoute(workflowInstanceOpsContract.batchSkipStuck, {
  handler: async (c) => {
    const res = await batchSkipStuckTokens(c.req.valid('json'));
    return c.json(okBody(res, `已推进 ${res.success}/${res.total} 个实例`), 200);
  },
});
export const batchSkipPreviewRoute = defineContractRoute(workflowInstanceOpsContract.batchSkipPreview, { handler: async c => c.json(okBody(await previewBatchSkipStuckTokens(c.req.valid('json'))), 200) });

export const jumpInstanceRoute = defineContractRoute(workflowInstanceOpsContract.jump, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { targetNodeKey, comment, previewToken } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await jumpInstance(id, targetNodeKey, comment, previewToken);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已跳转'), 200);
  },
});

export const reassignRoute = defineContractRoute(workflowTaskContract.reassign, {
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment } = c.req.valid('json');
    const before = await getWorkflowTaskForAdminAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const row = await reassignTask(taskId, targetUserId, comment);
    const after = await getWorkflowTaskForAdminAudit(taskId);
    setAuditAfterData(c, after ?? redactWorkflowSignatureImages(row));
    return c.json(okBody(row, '已改派'), 200);
  },
});

export const recallRoute = defineContractRoute(workflowTaskContract.recall, {
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const after = await recallTask(taskId, body.comment);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已撤回'), 200);
  },
});

export const suspendInstanceRoute = defineContractRoute(workflowInstanceOpsContract.suspend, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await suspendInstance(id, reason);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已挂起，自动推进已暂停'), 200);
  },
});

export const resumeInstanceRoute = defineContractRoute(workflowInstanceOpsContract.resume, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    const after = await resumeInstance(id);
    setAuditAfterData(c, redactWorkflowSignatureImages(after));
    return c.json(okBody(after, '已恢复流转，计时按剩余时长续跑'), 200);
  },
});

export const handoverPreviewRoute = defineContractRoute(workflowTaskContract.handoverPreview, {
  handler: async (c) => c.json(okBody(await previewHandover(c.req.valid('query').fromUserId)), 200),
});

export const handoverRoute = defineContractRoute(workflowTaskContract.handover, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const body = c.req.valid('json');
    const res = await handoverTasks(body);
    setAuditAfterData(c, { fromUserId: body.fromUserId, toUserId: body.toUserId, ...res, results: undefined });
    return c.json(okBody(res, `已交接 ${res.succeeded}/${res.taskTotal} 条待办`), 200);
  },
});
