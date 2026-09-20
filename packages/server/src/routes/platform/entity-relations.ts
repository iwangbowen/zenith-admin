import { OpenAPIHono } from '@hono/zod-openapi';
import { entityRelationsContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentUser } from '../../lib/context';
import { describeEntityRelations, listEntityRelation } from '../../services/platform/relations/registry';
import { changeEntityLink } from '../../services/platform/relations/edges.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const describeRoute = defineContractRoute(entityRelationsContract.describe, {
  handler: async (c) => {
    const params = c.req.valid('param');
    const result = await describeEntityRelations(params, { user: currentUser() });
    return c.json(okBody(result), 200);
  },
});

const listRoute = defineContractRoute(entityRelationsContract.section, {
  handler: async (c) => {
    const params = c.req.valid('param');
    const query = c.req.valid('query');
    const result = await listEntityRelation({ ...params, ...query }, { user: currentUser() });
    return c.json(okBody(result), 200);
  },
});

const linkRoute = defineContractRoute(entityRelationsContract.link, {
  handler: async (c) => {
    await changeEntityLink(c.req.valid('param'), c.req.valid('json').target, false);
    return c.json(okBody(null), 200);
  },
});
const unlinkRoute = defineContractRoute(entityRelationsContract.unlink, {
  handler: async (c) => {
    await changeEntityLink(c.req.valid('param'), c.req.valid('json').target, true);
    return c.json(okBody(null), 200);
  },
});
router.openapiRoutes([describeRoute, listRoute, linkRoute, unlinkRoute]);

export default router;
