import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowAutomationContract } from '@zenith/shared/workflow';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowAutomations,
  listWorkflowAutomationRuns,
  retryWorkflowAutomationRun,
  getWorkflowAutomation,
  createWorkflowAutomation,
  updateWorkflowAutomation,
  deleteWorkflowAutomation,
  batchDeleteWorkflowAutomations,
  getWorkflowAutomationsBeforeAudit,
} from '../../services/workflow/workflow-automations.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRunsRoute = defineContractRoute(workflowAutomationContract.runs, {
  handler: async (c) => c.json(okBody(await listWorkflowAutomationRuns(c.req.valid('query'))), 200),
});
const retryRunRoute = defineContractRoute(workflowAutomationContract.retryRun, {
  handler: async (c) => c.json(okBody(await retryWorkflowAutomationRun(c.req.valid('param').id), '已提交动作重试'), 200),
});
const batchDeleteRoute = defineContractRoute(workflowAutomationContract.batchDelete, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowAutomationsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const n = await batchDeleteWorkflowAutomations(ids);
    return c.json(okBody(null, `成功删除 ${n} 条`), 200);
  },
});

mountCrud(router, workflowAutomationContract,
  {
    list: listWorkflowAutomations,
    get: getWorkflowAutomation,
    create: createWorkflowAutomation,
    update: updateWorkflowAutomation,
    remove: deleteWorkflowAutomation,
  },
  {},
  [listRunsRoute, retryRunRoute, batchDeleteRoute],
);

export default router;
