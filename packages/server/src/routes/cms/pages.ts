import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsPageSchema, setCmsPageBlockAclSchema, updateCmsPageSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, PaginationQuery, IdParam,
} from '../../lib/openapi-schemas';
import { CmsPageBlockAclDTO, CmsPageDTO } from '../../lib/openapi-dtos';
import {
  listCmsPages, getCmsPage, createCmsPage, updateCmsPage, deleteCmsPage,
} from '../../services/cms/cms-pages.service';
import { triggerCustomPageStaticRefresh } from '../../services/cms/cms-static.service';
import { listCmsPageBlockAcls, setCmsPageBlockAcls } from '../../services/cms/cms-page-acl.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-页面搭建'], summary: '页面分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:page:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsPageDTO, '页面列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPages(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-页面搭建'], summary: '页面详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:page:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsPageDTO, '页面详情') },
  }),
  handler: async (c) => c.json(okBody(await getCmsPage(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-页面搭建'], summary: '创建页面',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:page:create', audit: { description: '创建 CMS 搭建页面', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsPageSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsPageDTO, '创建成功') },
  }),
  handler: async (c) => {
    const row = await createCmsPage(c.req.valid('json'));
    triggerCustomPageStaticRefresh({ siteId: row.siteId, slug: row.slug, isHome: row.isHome });
    return c.json(okBody(row, '创建成功'), 200);
  },
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-页面搭建'], summary: '更新页面',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:page:list', audit: { description: '更新 CMS 搭建页面', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsPageSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsPageDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getCmsPage(id);
    setAuditBeforeData(c, before);
    const row = await updateCmsPage(id, c.req.valid('json'));
    // slug 变化时移除旧路径文件
    if (before.slug !== row.slug) {
      triggerCustomPageStaticRefresh({ siteId: row.siteId, slug: before.slug, isHome: false, removed: true });
    }
    triggerCustomPageStaticRefresh({ siteId: row.siteId, slug: row.slug, isHome: row.isHome || before.isHome });
    return c.json(okBody(row, '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-页面搭建'], summary: '删除页面',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:page:delete', audit: { description: '删除 CMS 搭建页面', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const removed = await deleteCmsPage(c.req.valid('param').id);
    triggerCustomPageStaticRefresh({ siteId: removed.siteId, slug: removed.slug, isHome: removed.isHome, removed: true });
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listBlockAclsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/block-acls',
    tags: ['CMS-页面搭建'], summary: '查看页面区块 ACL',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:page:acl' })] as const,
    request: {
      params: IdParam,
      query: z.object({ blockId: z.string().min(1).max(100).optional() }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsPageBlockAclDTO), '区块 ACL') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPageBlockAcls(
    c.req.valid('param').id,
    c.req.valid('query').blockId,
  )), 200),
});

const setBlockAclsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/block-acls',
    tags: ['CMS-页面搭建'], summary: '批量设置页面区块 ACL（用户/角色）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'cms:page:acl',
      audit: { description: '设置 CMS 页面区块 ACL', module: 'CMS内容管理' },
    })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(setCmsPageBlockAclSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsPageBlockAclDTO), 'ACL 已更新') },
  }),
  handler: async (c) => {
    const pageId = c.req.valid('param').id;
    setAuditBeforeData(c, await listCmsPageBlockAcls(pageId));
    return c.json(okBody(await setCmsPageBlockAcls(pageId, c.req.valid('json')), '区块权限已更新'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  listBlockAclsRoute,
  setBlockAclsRoute,
  detailRoute,
  createRouteDef,
  updateRouteDef,
  deleteRouteDef,
] as const);

export default router;
