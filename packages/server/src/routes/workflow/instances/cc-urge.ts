// ─── 抄送与催办 ───
import { workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody } from '../../../lib/openapi-schemas';
import { getWorkflowInstanceBeforeAudit, urgeTask, listTaskUrges, listInstanceUrges, urgeInstance, addInstanceCc, markCcRead, forwardInstance } from '../../../services/workflow/workflow-instances.service';

export const ccReadRoute = defineContractRoute(workflowInstanceContract.ccRead, {
  handler: async (c) => {
    await markCcRead(c.req.valid('param').ccTaskId);
    return c.json(okBody(null, '已标记已读'), 200);
  },
});

export const forwardRoute = defineContractRoute(workflowInstanceContract.forward, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds, note } = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await forwardInstance(id, userIds, note);
    const after = await getWorkflowInstanceBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

export const urgeRoute = defineContractRoute(workflowTaskContract.urgeTask, {
  responses: { 429: { content: jsonContent(ErrorResponse), description: '催办过于频繁' } },
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const r = await urgeTask(taskId, message);
    return c.json(okBody(r, r.message), 200);
  },
});

export const listTaskUrgesRoute = defineContractRoute(workflowTaskContract.taskUrges, {
  handler: async (c) => c.json(okBody(await listTaskUrges(c.req.valid('param').taskId)), 200),
});

export const listInstanceUrgesRoute = defineContractRoute(workflowInstanceContract.urges, {
  handler: async (c) => c.json(okBody(await listInstanceUrges(c.req.valid('param').id)), 200),
});

export const urgeInstanceRoute = defineContractRoute(workflowInstanceContract.urge, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const r = await urgeInstance(id, message);
    return c.json(okBody(r, r.message), 200);
  },
});

export const addInstanceCcRoute = defineContractRoute(workflowInstanceContract.addCc, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { nodeKey, userIds } = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await addInstanceCc(id, nodeKey, userIds);
    const after = await getWorkflowInstanceBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r.list, r.message), 200);
  },
});
