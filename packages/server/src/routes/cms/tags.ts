import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsTagSchema, updateCmsTagSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsTagDTO } from '../../lib/openapi-dtos';
import {
  listCmsTags, listAllCmsTags, getCmsTag, createCmsTag, updateCmsTag, deleteCmsTag, ensureCmsTagExists, mapCmsTag,
} from '../../services/cms/cms-tags.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-标签管理'], summary: '标签分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:tag:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsTagDTO, '标签列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsTags(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all',
    tags: ['CMS-标签管理'], summary: '站点全部标签（内容打标下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsTagDTO), '标签列表') },
  }),
  handler: async (c) => c.json(okBody(await listAllCmsTags(c.req.valid('query').siteId)), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-标签管理'], summary: '标签详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:tag:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsTagDTO, '标签详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsTag(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-标签管理'], summary: '创建标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:tag:create', audit: { description: '创建 CMS 标签', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsTagSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsTagDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsTag(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-标签管理'], summary: '更新标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:tag:update', audit: { description: '更新 CMS 标签', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsTagSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsTagDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsTag(await ensureCmsTagExists(id)));
    return c.json(okBody(await updateCmsTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-标签管理'], summary: '删除标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:tag:delete', audit: { description: '删除 CMS 标签', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsTag(await ensureCmsTagExists(id)));
    await deleteCmsTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
