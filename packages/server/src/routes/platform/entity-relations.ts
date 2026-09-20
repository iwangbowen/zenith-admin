import { OpenAPIHono } from '@hono/zod-openapi';
import { entityRelationsContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentUser } from '../../lib/context';
import { describeEntityRelations, listEntityRelation } from '../../services/platform/relations/registry';

const router = new OpenAPIHono({ defaultHook: validationHook });

const describeRoute = defineContractRoute(entityRelationsContract.describe, {
  handler: async (c) => {
    const params = c.req.valid('param');
    const result = await describeEntityRelations(params, { user: currentUser() });
    return c.json(okBody(result), 200);
  },
});

const listRoute = defineContractRoute(entityRelationsContract.list, {
  handler: async (c) => {
    const params = c.req.valid('param');
    const query = c.req.valid('query');
    const result = await listEntityRelation({ ...params, ...query }, { user: currentUser() });
    return c.json(okBody(result), 200);
  },
});

router.openapiRoutes([describeRoute, listRoute]);

export default router;
