import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSubscriptionContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsSubscriptionAggregates,
  listCmsSubscriptions,
} from '../../services/cms/cms-subscriptions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:subscription:list' })] as const;

const listRoute = defineContractRoute(cmsSubscriptionContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsSubscriptions(c.req.valid('query'))), 200),
});

const aggregateRoute = defineContractRoute(cmsSubscriptionContract.aggregates, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsSubscriptionAggregates(c.req.valid('query'))), 200),
});

router.openapiRoutes([listRoute, aggregateRoute] as const);

export default router;
