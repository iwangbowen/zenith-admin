import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsStatContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getCmsVisitStats, getCmsSearchAnalytics } from '../../services/cms/cms-stats.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'cms:stat:view' })] as const;

const visitsRoute = defineContractRoute(cmsStatContract.visits, {
  middleware: view,
  handler: async (c) => {
    const { siteId, days } = c.req.valid('query');
    return c.json(okBody(await getCmsVisitStats(siteId, days)), 200);
  },
});

const searchRoute = defineContractRoute(cmsStatContract.search, {
  middleware: view,
  handler: async (c) => {
    const { siteId, days } = c.req.valid('query');
    return c.json(okBody(await getCmsSearchAnalytics(siteId, days)), 200);
  },
});

router.openapiRoutes([visitsRoute, searchRoute] as const);

export default router;
