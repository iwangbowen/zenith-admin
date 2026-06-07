import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, okBody, okExcel, excelStreamBody, okCsv, csvStreamBody } from '../lib/openapi-schemas';
import { LoginLogDTO, LoginLogStatsDTO } from '../lib/openapi-dtos';
import { listLoginLogs, loginLogStats, exportLoginLogs, exportLoginLogsAsCsv } from '../services/login-logs.service';

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

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['LoginLogs'], summary: '登录日志统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:login' })] as const,
    request: { query: z.object({ days: z.coerce.number().optional() }) },
    responses: { ...ok(LoginLogStatsDTO, '统计结果'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await loginLogStats(c.req.valid('query').days)), 200),
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

const exportCsvRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export/csv', tags: ['LoginLogs'], summary: '导出登录日志 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:login' })] as const,
    responses: { ...okCsv('CSV 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportLoginLogsAsCsv();
    return csvStreamBody(c, stream, filename);
  },
});

loginLogsRoute.openapiRoutes([listRoute, statsRoute, exportRoute, exportCsvRoute] as const);

export default loginLogsRoute;
