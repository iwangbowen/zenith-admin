// ─── 评论与征询 ───
import { workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getWorkflowInstanceBeforeAudit, getWorkflowTaskBeforeAudit } from '../../../services/workflow/workflow-instances.service';
import { listInstanceComments, addInstanceComment } from '../../../services/workflow/workflow-comments.service';
import { createConsult, replyConsult, listMyConsults, getConsultInstanceIdForAudit } from '../../../services/workflow/workflow-consults.service';

export const listCommentsRoute = defineContractRoute(workflowInstanceContract.comments, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
  handler: async (c) => c.json(okBody(await listInstanceComments(c.req.valid('param').id)), 200),
});

export const addCommentRoute = defineContractRoute(workflowInstanceContract.addComment, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '发表流程评论', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await addInstanceComment(c.req.valid('param').id, c.req.valid('json')), '已评论'), 200),
});

export const consultRoute = defineContractRoute(workflowTaskContract.consult, {
  middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '发起协办', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await createConsult(taskId, c.req.valid('json'));
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, '已发起协办'), 200);
  },
});

export const myConsultsRoute = defineContractRoute(workflowTaskContract.myConsults, {
  middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
  handler: async (c) => c.json(okBody(await listMyConsults(c.req.valid('query'))), 200),
});

export const replyConsultRoute = defineContractRoute(workflowTaskContract.replyConsult, {
  middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '回复协办意见', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const instanceId = await getConsultInstanceIdForAudit(id);
    const before = instanceId ? await getWorkflowInstanceBeforeAudit(instanceId) : null;
    if (before) setAuditBeforeData(c, before);
    const result = await replyConsult(id, c.req.valid('json'));
    const after = instanceId ? await getWorkflowInstanceBeforeAudit(instanceId) : null;
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, '已回复'), 200);
  },
});
