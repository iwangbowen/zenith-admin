import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  okPaginated, okMsg, BatchIdsBody, okBody, ok,
} from '../../lib/openapi-schemas';
import { CmsCommentDTO } from '../../lib/openapi-dtos';
import {
  listCmsComments, auditCmsComments, deleteCmsComments, countPendingComments,
} from '../../services/cms/cms-comments.service';
import { triggerContentStaticRefresh } from '../../services/cms/cms-static.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-评论管理'], summary: '评论分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:comment:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        source: z.enum(['member', 'guest']).optional().openapi({ description: '来源筛选：member=会员评论 guest=游客评论' }),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsCommentDTO, '评论列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsComments(c.req.valid('query'))), 200),
});

const pendingCountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/pending-count',
    tags: ['CMS-评论管理'], summary: '待审核评论数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:comment:list' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.object({ count: z.number().int() }), '待审核数') },
  }),
  handler: async (c) => c.json(okBody({ count: await countPendingComments(c.req.valid('query').siteId) }), 200),
});

const approveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/approve',
    tags: ['CMS-评论管理'], summary: '批量审核通过（同步刷新详情页静态文件）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:comment:audit', audit: { description: 'CMS 评论审核通过', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已通过') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await auditCmsComments(ids, 'approved');
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已通过 ${ids.length} 条评论`), 200);
  },
});

const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/reject',
    tags: ['CMS-评论管理'], summary: '批量拒绝',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:comment:audit', audit: { description: 'CMS 评论拒绝', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已拒绝') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await auditCmsComments(ids, 'rejected');
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已拒绝 ${ids.length} 条评论`), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/delete',
    tags: ['CMS-评论管理'], summary: '批量删除',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:comment:delete', audit: { description: 'CMS 评论删除', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const contentIds = await deleteCmsComments(ids);
    for (const contentId of contentIds) triggerContentStaticRefresh(contentId);
    return c.json(okBody(null, `已删除 ${ids.length} 条评论`), 200);
  },
});

router.openapiRoutes([listRoute, pendingCountRoute, approveRoute, rejectRoute, deleteRoute_] as const);

export default router;
