import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsDashboardContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCmsDashboardStats } from '../../services/cms/cms-dashboard.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const statsRoute = defineContractRoute(cmsDashboardContract.stats, {
  middleware: [authMiddleware, guard({ permission: 'cms:dashboard:view' })],
  handler: async (c) => c.json(okBody(await getCmsDashboardStats(c.req.valid('query').siteId)), 200),
});

router.openapiRoutes([statsRoute] as const);

export default router;
