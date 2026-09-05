import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowTriggerExecutionContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listTriggerExecutions, getTriggerExecution } from '../../services/workflow/workflow-trigger-executions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'workflow:trigger-execution:view' })] as const;

const list = defineContractRoute(workflowTriggerExecutionContract.list, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listTriggerExecutions(c.req.valid('query'))), 200),
});

const get = defineContractRoute(workflowTriggerExecutionContract.detail, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getTriggerExecution(c.req.valid('param').id)), 200),
});

router.openapiRoutes([list, get] as const);

export default router;
