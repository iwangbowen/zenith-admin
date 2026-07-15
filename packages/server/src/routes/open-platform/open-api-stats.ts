import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  PaginationQuery,
  okBody,
} from '../../lib/openapi-schemas';
import {
  OpenApiStatsOverviewDTO,
  OpenApiStatsTrendPointDTO,
  OpenApiStatsGroupItemDTO,
  OpenApiCallLogDTO,
} from '../../lib/openapi-dtos';
import {
  getOpenApiStatsOverview,
  getOpenApiStatsTrend,
  getOpenApiStatsByApp,
  getOpenApiStatsByEndpoint,
  listOpenApiCallLogs,
} from '../../services/open-platform/open-api-stats.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const RangeQuery = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  clientId: z.string().optional(),
});

const viewGuard = guard({ permission: 'open:stats:view' });

const overview = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/overview',
    tags: ['OpenApiStats'],
    summary: '调用统计总览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, viewGuard] as const,
    request: { query: RangeQuery },
    responses: { ...commonErrorResponses, ...ok(OpenApiStatsOverviewDTO, '调用统计总览') },
  }),
  handler: async (c) => c.json(okBody(await getOpenApiStatsOverview(c.req.valid('query'))), 200),
});

const trend = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/trend',
    tags: ['OpenApiStats'],
    summary: '调用趋势（按小时/天聚合）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, viewGuard] as const,
    request: { query: RangeQuery.extend({ granularity: z.enum(['hour', 'day']).optional().default('day') }) },
    responses: { ...commonErrorResponses, ...ok(z.array(OpenApiStatsTrendPointDTO), '调用趋势') },
  }),
  handler: async (c) => {
    const { startTime, endTime, clientId, granularity } = c.req.valid('query');
    return c.json(okBody(await getOpenApiStatsTrend({ startTime, endTime, clientId, granularity })), 200);
  },
});

const byApp = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/by-app',
    tags: ['OpenApiStats'],
    summary: '按应用聚合统计（Top N）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, viewGuard] as const,
    request: { query: RangeQuery.extend({ limit: z.coerce.number().int().min(1).max(50).optional().default(10) }) },
    responses: { ...commonErrorResponses, ...ok(z.array(OpenApiStatsGroupItemDTO), '按应用统计') },
  }),
  handler: async (c) => {
    const { startTime, endTime, clientId, limit } = c.req.valid('query');
    return c.json(okBody(await getOpenApiStatsByApp({ startTime, endTime, clientId, limit })), 200);
  },
});

const byEndpoint = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/by-endpoint',
    tags: ['OpenApiStats'],
    summary: '按端点聚合统计（Top N）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, viewGuard] as const,
    request: { query: RangeQuery.extend({ limit: z.coerce.number().int().min(1).max(50).optional().default(10) }) },
    responses: { ...commonErrorResponses, ...ok(z.array(OpenApiStatsGroupItemDTO), '按端点统计') },
  }),
  handler: async (c) => {
    const { startTime, endTime, clientId, limit } = c.req.valid('query');
    return c.json(okBody(await getOpenApiStatsByEndpoint({ startTime, endTime, clientId, limit })), 200);
  },
});

const logs = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/logs',
    tags: ['OpenApiStats'],
    summary: '调用日志列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, viewGuard] as const,
    request: {
      query: PaginationQuery.extend({
        clientId: z.string().optional(),
        success: z.enum(['true', 'false']).optional(),
        method: z.string().max(10).optional(),
        statusCode: z.coerce.number().int().min(100).max(599).optional(),
        keyword: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(OpenApiCallLogDTO, '调用日志列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, clientId, success, method, statusCode, keyword, startTime, endTime } = c.req.valid('query');
    return c.json(
      okBody(
        await listOpenApiCallLogs({
          page,
          pageSize,
          clientId,
          success: success === undefined ? undefined : success === 'true',
          method,
          statusCode,
          keyword,
          startTime,
          endTime,
        }),
      ),
      200,
    );
  },
});

router.openapiRoutes([overview, trend, byApp, byEndpoint, logs] as const);

export default router;
