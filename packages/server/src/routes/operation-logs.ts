import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { PaginationQuery, validationHook, commonErrorResponses, ok, okPaginated, okBody, okExcel, excelStreamBody, okCsv, csvStreamBody, okMsg } from '../lib/openapi-schemas';
import { OperationLogDTO, OperationLogStatsDTO } from '../lib/openapi-dtos';
import { listOperationLogs, operationLogStats, exportOperationLogs, exportOperationLogsAsCsv, cleanOperationLogs, getCleanOperationLogsBeforeAudit } from '../services/operation-logs.service';

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

const exportFilterQuery = z.object({
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
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['OperationLogs'], summary: '导出操作日志 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    request: { query: exportFilterQuery },
    responses: { ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportOperationLogs(c.req.valid('query'));
    return excelStreamBody(c, stream, filename);
  },
});

const exportCsvRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export/csv', tags: ['OperationLogs'], summary: '导出操作日志 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:operation' })] as const,
    request: { query: exportFilterQuery },
    responses: { ...okCsv('CSV 文件') },
  }),
  handler: async (c) => {
    const { stream, filename } = await exportOperationLogsAsCsv(c.req.valid('query'));
    return csvStreamBody(c, stream, filename);
  },
});

const cleanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/clean', tags: ['OperationLogs'], summary: '清除操作日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:log:operation',
      audit: { description: '清除操作日志', module: '操作日志' },
    })] as const,
    request: { query: z.object({ months: z.coerce.number().int().min(0).default(0) }) },
    responses: { ...okMsg('清除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { months } = c.req.valid('query');
    const before = await getCleanOperationLogsBeforeAudit(months);
    setAuditBeforeData(c, before);
    const deleted = await cleanOperationLogs(months);
    setAuditAfterData(c, { months, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条操作日志`), 200);
  },
});

operationLogsRoute.openapiRoutes([listRoute, statsRoute, exportRoute, exportCsvRoute, cleanRoute] as const);

export default operationLogsRoute;
