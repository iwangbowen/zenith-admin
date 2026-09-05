import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowHealthContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getWorkflowHealthSummary } from '../../services/workflow/workflow-health.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const summaryRoute = defineContractRoute(workflowHealthContract.summary, {
  middleware: [authMiddleware, guard({ permission: 'workflow:health:view' })] as const,
  handler: async (c) => {
    const { thresholdMinutes } = c.req.valid('query');
    return c.json(okBody(await getWorkflowHealthSummary(thresholdMinutes ?? 30)), 200);
  },
});

router.openapiRoutes([summaryRoute] as const);

export default router;
