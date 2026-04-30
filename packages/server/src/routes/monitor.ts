import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { MonitorDTO, MonitorTimeseriesDTO } from '../lib/openapi-dtos';
import { getMonitorStatus, getMonitorTimeseries } from '../services/monitor.service';

const monitorRouter = new OpenAPIHono({ defaultHook: validationHook });

const statusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Monitor'],
    summary: '获取服务器监控信息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:monitor:view' })] as const,
    responses: { ...ok(MonitorDTO, '监控数据'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getMonitorStatus(), 'success'), 200),
});

const timeseriesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/timeseries',
    tags: ['Monitor'],
    summary: '获取最近 1h 监控时序数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:monitor:view' })] as const,
    responses: { ...ok(MonitorTimeseriesDTO, '时序数据'), ...commonErrorResponses },
  }),
  handler: (c) => c.json(okBody(getMonitorTimeseries(), 'success'), 200),
});

monitorRouter.openapiRoutes([statusRoute, timeseriesRoute] as const);

export default monitorRouter;
