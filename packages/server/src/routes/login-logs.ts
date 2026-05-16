import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, okPaginated, okBody, okExcel, excelStreamBody } from '../lib/openapi-schemas';
import { LoginLogDTO } from '../lib/openapi-dtos';
import { listLoginLogs, exportLoginLogs } from '../services/login-logs.service';

const loginLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['LoginLogs'], summary: '登录日志分页查询',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:login' })] as const,
    request: {
      query: PaginationQuery.extend({
        username: z.string().optional(),
        status: z.enum(['success', 'fail']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(LoginLogDTO, '登录日志列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listLoginLogs(c.req.valid('query'))), 200),
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['LoginLogs'], summary: '导出登录日志 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:login' })] as const,
    responses: { ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportLoginLogs();
    return excelStreamBody(c, stream, filename);
  },
});

loginLogsRoute.openapiRoutes([listRoute, exportRoute] as const);

export default loginLogsRoute;
