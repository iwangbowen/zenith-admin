import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { DashboardStatsDTO as StatsDTO, DashboardChartsDTO as ChartsDTO } from '../lib/openapi-dtos';
import { getDashboardStats, getDashboardCharts } from '../services/dashboard.service';

const dashboardRoute = new OpenAPIHono({ defaultHook: validationHook });

const statsRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['Dashboard'], summary: '仪表盘统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(StatsDTO, '统计数据'),
      403: { content: jsonContent(ErrorResponse), description: '无权限' },
    },
  }),
  handler: async (c) => c.json(okBody(await getDashboardStats()), 200),
});

const chartsRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/charts', tags: ['Dashboard'], summary: '仪表盘图表数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(ChartsDTO, '图表数据'),
      403: { content: jsonContent(ErrorResponse), description: '无权限' },
    },
  }),
  handler: async (c) => c.json(okBody(await getDashboardCharts()), 200),
});

dashboardRoute.openapiRoutes([statsRouteDef, chartsRouteDef] as const);

export default dashboardRoute;
