import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { commonErrorResponses, ok, okBody, validationHook } from '../../lib/openapi-schemas';
import { CmsDashboardStatsDTO } from '../../lib/openapi-dtos';
import { getCmsDashboardStats } from '../../services/cms/cms-dashboard.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats',
    tags: ['CMS-内容管理'], summary: 'CMS 数据看板统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:dashboard:view' })] as const,
    request: {
      query: z.object({ siteId: z.coerce.number().int().positive() }),
    },
    responses: { ...commonErrorResponses, ...ok(CmsDashboardStatsDTO, '看板统计') },
  }),
  handler: async (c) => c.json(okBody(await getCmsDashboardStats(c.req.valid('query').siteId)), 200),
});

router.openapiRoutes([statsRoute] as const);

export default router;
