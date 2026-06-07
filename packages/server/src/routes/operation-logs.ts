import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, okBody, okExcel, excelStreamBody } from '../lib/openapi-schemas';
import { OperationLogDTO, OperationLogStatsDTO } from '../lib/openapi-dtos';
import { listOperationLogs, operationLogStats, exportOperationLogs } from '../services/operation-logs.service';

const operationLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['OperationLogs'], summary: '操作日志分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    request: {
      query: PaginationQuery.extend({
        username: z.string().optional(),
        module: z.string().optional(),
        description: z.string().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
        ip: z.string().optional(),
        status: z.enum(['success', 'fail']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        minDurationMs: z.coerce.number().int().nonnegative().optional(),
        maxDurationMs: z.coerce.number().int().nonnegative().optional(),
      }),
    },
    responses: { ...okPaginated(OperationLogDTO, '日志列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listOperationLogs(c.req.valid('query'))), 200),
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['OperationLogs'], summary: '操作日志统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    request: { query: z.object({ days: z.coerce.number().optional() }) },
    responses: { ...ok(OperationLogStatsDTO, '统计结果'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await operationLogStats(c.req.valid('query').days)), 200),
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['OperationLogs'], summary: '导出操作日志 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    responses: { ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportOperationLogs();
    return excelStreamBody(c, stream, filename);
  },
});

operationLogsRoute.openapiRoutes([listRoute, statsRoute, exportRoute] as const);

export default operationLogsRoute;
