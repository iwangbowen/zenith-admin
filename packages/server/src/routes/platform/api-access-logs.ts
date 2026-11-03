import { OpenAPIHono } from '@hono/zod-openapi';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getApiAccessLog, listApiAccessLogs } from '../../services/platform/api-access-logs.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(apiAccessLogContract.list, {
  handler: async (c) => c.json(okBody(await listApiAccessLogs(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(apiAccessLogContract.detail, {
  handler: async (c) => c.json(okBody(await getApiAccessLog(c.req.valid('param').id)), 200),
});

router.openapiRoutes([listRoute, detailRoute]);

export default router;

