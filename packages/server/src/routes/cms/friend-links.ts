import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsFriendLinkSchema, updateCmsFriendLinkSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsFriendLinkDTO } from '../../lib/openapi-dtos';
import {
  listCmsFriendLinks, createCmsFriendLink, updateCmsFriendLink, deleteCmsFriendLink,
  ensureCmsFriendLinkExists, mapCmsFriendLink,
} from '../../services/cms/cms-friend-links.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-友情链接'], summary: '友链分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:link:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsFriendLinkDTO, '友链列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsFriendLinks(c.req.valid('query'))), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-友情链接'], summary: '创建友链',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:link:create', audit: { description: '创建 CMS 友情链接', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsFriendLinkSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsFriendLinkDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsFriendLink(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-友情链接'], summary: '更新友链',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:link:update', audit: { description: '更新 CMS 友情链接', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsFriendLinkSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsFriendLinkDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLink(await ensureCmsFriendLinkExists(id)));
    return c.json(okBody(await updateCmsFriendLink(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-友情链接'], summary: '删除友链',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:link:delete', audit: { description: '删除 CMS 友情链接', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLink(await ensureCmsFriendLinkExists(id)));
    await deleteCmsFriendLink(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
