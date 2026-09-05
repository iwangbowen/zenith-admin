import { OpenAPIHono } from '@hono/zod-openapi';
import { ipAccessLogContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listIpAccessLogs } from '../../services/platform/ip-access-logs.service';

const ipAccessLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(ipAccessLogContract.list, {
  middleware: [authMiddleware, guard({ permission: 'system:ip-access:log' })],
  handler: async (c) => c.json(okBody(await listIpAccessLogs(c.req.valid('query'))), 200),
});

ipAccessLogsRoute.openapiRoutes([listRoute] as const);

export default ipAccessLogsRoute;
