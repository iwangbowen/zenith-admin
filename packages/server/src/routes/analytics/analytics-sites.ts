
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { commonErrorResponses, IdParam, ok, okBody, okMsg, okPaginated, PaginationQuery, validationHook } from '../../lib/openapi-schemas';
import { AnalyticsSiteDTO, CreateAnalyticsSiteDTO, UpdateAnalyticsSiteDTO } from '../../lib/openapi-dtos';
import { createSite, deleteSite, listSites, regenerateSiteKey, updateSite } from '../../services/analytics/analytics-sites.service';

const r = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/sites', tags: ['Analytics'], summary: '站点列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { query: PaginationQuery.extend({ name: z.string().optional(), appId: z.string().optional(), status: z.enum(['enabled', 'disabled']).or(z.literal('')).optional() }) },
    responses: { ...okPaginated(AnalyticsSiteDTO, '站点列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listSites(c.req.valid('query'))), 200),
});

const createSiteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sites', tags: ['Analytics'], summary: '创建站点', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '创建站点' } })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsSiteDTO } }, required: true } },
    responses: { ...ok(AnalyticsSiteDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createSite(c.req.valid('json')), '创建成功'), 200),
});

const updateSiteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/sites/{id}', tags: ['Analytics'], summary: '更新站点', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '更新站点' } })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateAnalyticsSiteDTO } }, required: true } },
    responses: { ...ok(AnalyticsSiteDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateSite(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteSiteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/sites/{id}', tags: ['Analytics'], summary: '删除站点', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '删除站点' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => { await deleteSite(c.req.valid('param').id); return c.json(okBody(null, '删除成功'), 200); },
});

const regenerateKeyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sites/{id}/regenerate-key', tags: ['Analytics'], summary: '重新生成站点 Key', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '重新生成站点 Key' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(AnalyticsSiteDTO, '重新生成成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await regenerateSiteKey(c.req.valid('param').id), '重新生成成功'), 200),
});

r.openapiRoutes([listRoute, createSiteRoute, updateSiteRoute, deleteSiteRoute, regenerateKeyRoute] as const);

export default r;
