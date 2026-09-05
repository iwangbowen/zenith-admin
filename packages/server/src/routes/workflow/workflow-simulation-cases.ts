import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowSimulationCaseContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listSimulationCases, saveSimulationCase, deleteSimulationCase } from '../../services/workflow/workflow-simulation-cases.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(workflowSimulationCaseContract.list, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
  handler: async (c) => c.json(okBody(await listSimulationCases(c.req.valid('query').definitionId)), 200),
});

const saveRoute = defineContractRoute(workflowSimulationCaseContract.save, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '保存流程仿真用例', module: '流程仿真' } })] as const,
  handler: async (c) => c.json(okBody(await saveSimulationCase(c.req.valid('json')), '已保存'), 200),
});

const deleteRoute = defineContractRoute(workflowSimulationCaseContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '删除流程仿真用例', module: '流程仿真' } })] as const,
  handler: async (c) => {
    await deleteSimulationCase(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, saveRoute, deleteRoute] as const);

export default router;
