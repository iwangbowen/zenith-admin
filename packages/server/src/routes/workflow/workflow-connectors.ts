import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowConnectorContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowConnectors, getWorkflowConnector, createWorkflowConnector,
  updateWorkflowConnector, deleteWorkflowConnector, testWorkflowConnector,
  getConnectorStats, listConnectorInvocations,
} from '../../services/workflow/workflow-connectors.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'workflow:connector:list' })] as const;

const listRoute = defineContractRoute(workflowConnectorContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listWorkflowConnectors(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(workflowConnectorContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getWorkflowConnector(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(workflowConnectorContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:connector:create', audit: { description: '创建流程连接器', module: '流程连接器' } })] as const,
  handler: async (c) => c.json(okBody(await createWorkflowConnector(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(workflowConnectorContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:connector:update', audit: { description: '更新流程连接器', module: '流程连接器' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getWorkflowConnector(id));
    return c.json(okBody(await updateWorkflowConnector(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(workflowConnectorContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:connector:delete', audit: { description: '删除流程连接器', module: '流程连接器' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getWorkflowConnector(id));
    await deleteWorkflowConnector(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const testRoute = defineContractRoute(workflowConnectorContract.test, {
  middleware: [authMiddleware, guard({ permission: 'workflow:connector:test', audit: { description: '测试流程连接器', module: '流程连接器' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testWorkflowConnector(id, c.req.valid('json'))), 200);
  },
});

const statsRoute = defineContractRoute(workflowConnectorContract.stats, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getConnectorStats(c.req.valid('param').id, c.req.valid('query').days)), 200),
});

const invocationsRoute = defineContractRoute(workflowConnectorContract.invocations, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listConnectorInvocations(c.req.valid('param').id, c.req.valid('query').limit)), 200),
});

router.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, testRoute, statsRoute, invocationsRoute] as const);

export default router;
