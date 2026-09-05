import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowAutomationContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowAutomations,
  listWorkflowAutomationRuns,
  getWorkflowAutomation,
  createWorkflowAutomation,
  updateWorkflowAutomation,
  deleteWorkflowAutomation,
  batchDeleteWorkflowAutomations,
  getWorkflowAutomationBeforeAudit,
  getWorkflowAutomationsBeforeAudit,
} from '../../services/workflow/workflow-automations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const;

const listRoute = defineContractRoute(workflowAutomationContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listWorkflowAutomations(c.req.valid('query'))), 200),
});

const listRunsRoute = defineContractRoute(workflowAutomationContract.runs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listWorkflowAutomationRuns(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(workflowAutomationContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getWorkflowAutomation(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(workflowAutomationContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '创建流程自动化规则', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createWorkflowAutomation(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(workflowAutomationContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程自动化规则', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowAutomationBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateWorkflowAutomation(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(workflowAutomationContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '删除流程自动化规则', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowAutomationBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteWorkflowAutomation(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchDeleteRoute = defineContractRoute(workflowAutomationContract.batchDelete, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '批量删除流程自动化规则', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowAutomationsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const n = await batchDeleteWorkflowAutomations(ids);
    return c.json(okBody(null, `成功删除 ${n} 条`), 200);
  },
});

router.openapiRoutes([listRoute, listRunsRoute, getRoute, createRouteDef, updateRoute, deleteRoute, batchDeleteRoute] as const);

export default router;
