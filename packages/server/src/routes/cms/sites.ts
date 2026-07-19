import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsSiteSchema, updateCmsSiteSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsSiteDTO, CmsThemeDTO, CmsSiteUsersDTO } from '../../lib/openapi-dtos';
import { listThemes } from '../../cms/themes/registry';
import {
  listCmsSites, listAllCmsSites, getCmsSite, createCmsSite, updateCmsSite, deleteCmsSite,
  ensureCmsSiteExists, mapCmsSite, getCmsSiteUsers, setCmsSiteUsers, enableSiteAnalytics,
} from '../../services/cms/cms-sites.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-站点管理'], summary: '站点分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsSiteDTO, '站点列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsSites(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all',
    tags: ['CMS-站点管理'], summary: '全部启用站点（站点切换器）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(CmsSiteDTO), '站点列表') },
  }),
  handler: async (c) => c.json(okBody(await listAllCmsSites()), 200),
});

const themesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/themes',
    tags: ['CMS-站点管理'], summary: '可用主题列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(CmsThemeDTO), '主题列表') },
  }),
  handler: (c) => c.json(okBody(listThemes()), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-站点管理'], summary: '站点详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsSiteDTO, '站点详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsSite(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-站点管理'], summary: '创建站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:create', audit: { description: '创建 CMS 站点', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsSiteSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsSiteDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsSite(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-站点管理'], summary: '更新站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: '更新 CMS 站点', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsSiteSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsSiteDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSite(await ensureCmsSiteExists(id)));
    return c.json(okBody(await updateCmsSite(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-站点管理'], summary: '删除站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:delete', audit: { description: '删除 CMS 站点', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSite(await ensureCmsSiteExists(id)));
    await deleteCmsSite(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 站点授权用户（站点级数据权限）────────────────────────────────────────────
const getSiteUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/users',
    tags: ['CMS-站点管理'], summary: '站点授权用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsSiteUsersDTO, '授权用户') },
  }),
  handler: async (c) => c.json(okBody(await getCmsSiteUsers(c.req.valid('param').id)), 200),
});

const setSiteUsersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/users',
    tags: ['CMS-站点管理'], summary: '设置站点授权用户（绑定后仅授权用户可管理该站点）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: '设置 CMS 站点授权用户', module: 'CMS内容管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ userIds: z.array(z.number().int().positive()).default([]) })), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('保存成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getCmsSiteUsers(id);
    setAuditBeforeData(c, before);
    await setCmsSiteUsers(id, userIds);
    const after = await getCmsSiteUsers(id);
    setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

// ─── 开通行为统计（P3：自动创建 analytics 站点并注入采集脚本）───────────────────
const enableAnalyticsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/enable-analytics',
    tags: ['CMS-站点管理'], summary: '开通行为统计（自动创建统计站点，前台注入采集脚本）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: 'CMS 站点开通行为统计', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.object({ siteKey: z.string(), created: z.boolean() }), '已开通') },
  }),
  handler: async (c) => {
    const result = await enableSiteAnalytics(c.req.valid('param').id);
    return c.json(okBody(result, result.created ? '已开通行为统计' : '行为统计已开通过'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, themesRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, getSiteUsersRoute, setSiteUsersRoute, enableAnalyticsRoute] as const);

export default router;
