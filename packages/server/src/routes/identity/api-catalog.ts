import { OpenAPIHono } from '@hono/zod-openapi';
import { apiCatalogContract, permissionCatalogContract } from '@zenith/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { notModifiedResponse, okBody, validationHook } from '../../lib/openapi-schemas';
import { createStaticJsonResponder } from '../../lib/static-json-response';
import { getApiCatalog } from '../../services/identity/api-catalog.service';
import { getPermissionCatalog } from '../../services/identity/permission-directory.service';

const apiCatalogRouter = new OpenAPIHono({ defaultHook: validationHook });
const catalogResponse = createStaticJsonResponder(() => okBody(getApiCatalog()));

const getRoute = defineContractRoute(apiCatalogContract.get, {
  responses: notModifiedResponse,
  handler: (c) => catalogResponse.respond(c),
});
const permissionRoute = defineContractRoute(permissionCatalogContract.directory, {
  handler: async (c) => c.json(okBody(await getPermissionCatalog()), 200),
});

apiCatalogRouter.openapiRoutes([getRoute, permissionRoute] as const);

export default apiCatalogRouter;
