import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { MonitorDTO } from '../lib/openapi-dtos';
import { getMonitorStatus } from '../services/monitor.service';

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

monitorRouter.openapiRoutes([statusRoute] as const);

export default monitorRouter;
