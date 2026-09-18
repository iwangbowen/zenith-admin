import { OpenAPIHono } from '@hono/zod-openapi';
import { globalSearchContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { searchGlobal } from '../../services/platform/search/global-search.service';

const globalSearchRouter = new OpenAPIHono({ defaultHook: validationHook });

const searchRoute = defineContractRoute(globalSearchContract.search, {
  handler: async (c) => c.json(okBody(await searchGlobal(c.req.valid('query'))), 200),
});

globalSearchRouter.openapiRoutes([searchRoute]);

export default globalSearchRouter;

