import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createReportDashboardSchema, updateReportDashboardSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { ReportDashboardDTO } from '../lib/openapi-dtos';
import {
  listDashboards, getDashboard, createDashboard, updateDashboard,
  deleteDashboard, ensureDashboardExists,
} from '../services/report-dashboard.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['报表仪表盘'], summary: '仪表盘列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ReportDashboardDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDashboards(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['报表仪表盘'], summary: '仪表盘详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getDashboard(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['报表仪表盘'], summary: '创建仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:create', audit: { description: '创建报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { body: { content: jsonContent(createReportDashboardSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createDashboard(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['报表仪表盘'], summary: '更新仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '更新报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportDashboardSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateDashboard(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['报表仪表盘'], summary: '删除仪表盘',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:delete', audit: { description: '删除报表仪表盘', module: '报表仪表盘' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDashboardExists(id);
    setAuditBeforeData(c, before);
    await deleteDashboard(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
