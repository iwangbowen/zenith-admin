import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { commonErrorResponses, ok, okBody, validationHook } from '../lib/openapi-schemas';
import { WorkflowHealthSummaryDTO } from '../lib/openapi-dtos';
import { getWorkflowHealthSummary } from '../services/workflow-health.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const summaryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['WorkflowHealth'],
    summary: '工作流健康巡检',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:health:view' })] as const,
    request: {
      query: z.object({
        thresholdMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(WorkflowHealthSummaryDTO, '健康巡检结果') },
  }),
  handler: async (c) => {
    const { thresholdMinutes } = c.req.valid('query');
    return c.json(okBody(await getWorkflowHealthSummary(thresholdMinutes ?? 30)), 200);
  },
});

router.openapiRoutes([summaryRoute] as const);

export default router;
