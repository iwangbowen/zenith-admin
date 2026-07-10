import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { createReportCategorySchema, reportLookupQuerySchema, updateReportCategorySchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { ReportDashboardCategoryDTO, ReportLookupOptionDTO } from '../../lib/openapi-dtos';
import { z } from '@hono/zod-openapi';
import { listCategories, createCategory, updateCategory, deleteCategory, ensureCategoryExists, listCategoryLookup } from '../../services/report/report-ops.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['报表分类'], summary: '分类列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ReportDashboardCategoryDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listCategories()), 200),
});

const lookupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/lookup',
    tags: ['报表分类'], summary: '分类轻量下拉',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:list' })] as const,
    request: { query: reportLookupQuerySchema.omit({ status: true }) },
    responses: { ...commonErrorResponses, ...ok(z.array(ReportLookupOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listCategoryLookup(c.req.valid('query'))), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['报表分类'], summary: '创建分类',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '创建报表分类', module: '报表分类' } })] as const,
    request: { body: { content: jsonContent(createReportCategorySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardCategoryDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCategory(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['报表分类'], summary: '更新分类',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '更新报表分类', module: '报表分类' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateReportCategorySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardCategoryDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCategoryExists(id));
    return c.json(okBody(await updateCategory(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['报表分类'], summary: '删除分类',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'report:dashboard:update', audit: { description: '删除报表分类', module: '报表分类' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCategoryExists(id));
    await deleteCategory(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, lookupRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
