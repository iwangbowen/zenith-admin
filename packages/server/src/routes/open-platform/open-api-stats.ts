import { OpenAPIHono } from '@hono/zod-openapi';
import { openApiStatsContract } from '@zenith/shared/open-platform';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  getOpenApiStatsOverview,
  getOpenApiStatsTrend,
  getOpenApiStatsByApp,
  getOpenApiStatsByEndpoint,
  listOpenApiCallLogs,
} from '../../services/open-platform/open-api-stats.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'open:stats:view' })] as const;

const overview = defineContractRoute(openApiStatsContract.overview, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getOpenApiStatsOverview(c.req.valid('query'))), 200),
});

const trend = defineContractRoute(openApiStatsContract.trend, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getOpenApiStatsTrend(c.req.valid('query'))), 200),
});

const byApp = defineContractRoute(openApiStatsContract.byApp, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getOpenApiStatsByApp(c.req.valid('query'))), 200),
});

const byEndpoint = defineContractRoute(openApiStatsContract.byEndpoint, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getOpenApiStatsByEndpoint(c.req.valid('query'))), 200),
});

const logs = defineContractRoute(openApiStatsContract.logs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listOpenApiCallLogs(c.req.valid('query'))), 200),
});

router.openapiRoutes([overview, trend, byApp, byEndpoint, logs] as const);

export default router;
