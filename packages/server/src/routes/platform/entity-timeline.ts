import { OpenAPIHono } from '@hono/zod-openapi';
import { entityTimelineContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentUser } from '../../lib/context';
import { listEntityTimeline } from '../../services/platform/relations/timeline';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(entityTimelineContract.timeline, {
  handler: async (c) => {
    const params = c.req.valid('param');
    const query = c.req.valid('query');
    const result = await listEntityTimeline({ ...params, ...query }, { user: currentUser() });
    return c.json(okBody(result), 200);
  },
});

router.openapiRoutes([listRoute]);

export default router;
