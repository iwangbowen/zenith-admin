import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, okMsg, okPaginated, ok, okBody } from '../lib/openapi-schemas';
import { ErrorReportInputDTO, FrontendErrorDTO, ErrorStatsDTO } from '../lib/openapi-dtos';
import { reportError, listErrors, cleanErrors, getErrorStats } from '../services/frontend-errors.service';

const errorsRoute = new OpenAPIHono({ defaultHook: validationHook });

const reportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['FrontendErrors'],
    summary: '上报前端错误',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: { 'application/json': { schema: ErrorReportInputDTO } }, required: true } },
    responses: { ...okMsg('上报成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await reportError(c.req.valid('json'));
    return c.json(okBody(null, '上报成功'), 200);
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['FrontendErrors'],
    summary: '前端错误列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:list' })] as const,
    request: {
      query: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        errorType: z.enum(['js_error', 'promise_rejection', 'resource_error', 'console_error']).optional(),
        username: z.string().optional(),
        message: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(FrontendErrorDTO, '错误列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listErrors(c.req.valid('query'))), 200),
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/stats',
    tags: ['FrontendErrors'],
    summary: '前端错误统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:list' })] as const,
    request: {
      query: z.object({
        days: z.coerce.number().int().min(1).max(365).optional().default(30),
      }),
    },
    responses: { ...ok(ErrorStatsDTO, '错误统计'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getErrorStats(c.req.valid('query').days)), 200),
});

const cleanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/clean',
    tags: ['FrontendErrors'],
    summary: '清除前端错误数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const,
    request: {
      query: z.object({
        days: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: { ...okMsg('清除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const deleted = await cleanErrors(days);
    return c.json(okBody(null, `共清除 ${deleted} 条错误记录`), 200);
  },
});

errorsRoute.openapiRoutes([reportRoute, listRoute, statsRoute, cleanRoute] as const);

export default errorsRoute;
