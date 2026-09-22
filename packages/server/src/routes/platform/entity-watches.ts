import { OpenAPIHono } from '@hono/zod-openapi';
import { entityWatchContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { changeEntityWatch, getEntityWatchState } from '../../services/platform/entity-watches.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(entityWatchContract.state, { handler: async (c) => c.json(okBody(await getEntityWatchState(c.req.valid('param'))), 200) }),
  defineContractRoute(entityWatchContract.follow, { handler: async (c) => c.json(okBody(await changeEntityWatch(c.req.valid('param'), true)), 200) }),
  defineContractRoute(entityWatchContract.unfollow, { handler: async (c) => c.json(okBody(await changeEntityWatch(c.req.valid('param'), false)), 200) }),
]);
export default router;
