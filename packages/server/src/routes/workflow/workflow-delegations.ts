import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowDelegationContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowDelegations, createWorkflowDelegation, updateWorkflowDelegation, deleteWorkflowDelegation,
  getWorkflowDelegationBeforeAudit,
} from '../../services/workflow/workflow-delegations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(workflowDelegationContract.list, {
  middleware: [authMiddleware, guard({ permission: 'workflow:delegation:view' })] as const,
  handler: async (c) => c.json(okBody(await listWorkflowDelegations(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(workflowDelegationContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:delegation:manage', audit: { description: '新增审批代理', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createWorkflowDelegation(c.req.valid('json')), '已新增'), 200),
});

const updateRoute = defineContractRoute(workflowDelegationContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:delegation:manage', audit: { description: '更新审批代理', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDelegationBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateWorkflowDelegation(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteRoute = defineContractRoute(workflowDelegationContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:delegation:manage', audit: { description: '删除审批代理', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDelegationBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteWorkflowDelegation(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
