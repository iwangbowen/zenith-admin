import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  NginxInfoDTO,
  NginxSiteDTO,
  NginxSiteDetailDTO,
  CreateNginxSiteDTO,
  UpdateNginxSiteContentDTO,
  NginxTestResultDTO,
} from '../lib/openapi-dtos';
import { ok, okMsg, okBody, validationHook, commonErrorResponses, jsonContent } from '../lib/openapi-schemas';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import {
  getNginxInfo,
  listNginxSites,
  getNginxSiteDetail,
  createNginxSite,
  updateNginxSiteContent,
  deleteNginxSite,
  enableNginxSite,
  disableNginxSite,
  testNginxConfig,
  reloadNginx,
} from '../services/nginx-sites.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const SiteNameParam = z.object({
  name: z.string().min(1).max(100).openapi({
    param: { name: 'name', in: 'path' },
    example: 'example.com',
  }),
});

const infoRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/info',
    tags: ['Nginx站点'],
    summary: '获取 Nginx 信息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(NginxInfoDTO, 'Nginx 信息') },
  }),
  handler: async (c) => c.json(okBody(await getNginxInfo()), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Nginx站点'],
    summary: '获取 Nginx 站点列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(NginxSiteDTO), 'Nginx 站点列表') },
  }),
  handler: async (c) => c.json(okBody(await listNginxSites()), 200),
});

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/test',
    tags: ['Nginx站点'],
    summary: '测试 Nginx 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description: '测试 Nginx 配置', module: 'Nginx 站点' } })] as const,
    responses: { ...commonErrorResponses, ...ok(NginxTestResultDTO, '测试结果') },
  }),
  handler: async (c) => c.json(okBody(await testNginxConfig()), 200),
});

const reloadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/reload',
    tags: ['Nginx站点'],
    summary: '重载 Nginx',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:reload', audit: { description: '重载 Nginx', module: 'Nginx 站点' } })] as const,
    responses: { ...commonErrorResponses, ...okMsg('Nginx 已重载') },
  }),
  handler: async (c) => {
    await reloadNginx();
    return c.json(okBody(null, 'Nginx 已重载'), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/:name',
    tags: ['Nginx站点'],
    summary: '获取 Nginx 站点详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:view' })] as const,
    request: { params: SiteNameParam },
    responses: { ...commonErrorResponses, ...ok(NginxSiteDetailDTO, '站点详情') },
  }),
  handler: async (c) => c.json(okBody(await getNginxSiteDetail(c.req.valid('param').name)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['Nginx站点'],
    summary: '创建 Nginx 站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description: '创建 Nginx 站点', module: 'Nginx 站点' } })] as const,
    request: { body: { content: jsonContent(CreateNginxSiteDTO), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('站点已创建') },
  }),
  handler: async (c) => {
    const input = c.req.valid('json');
    await createNginxSite(input);
    setAuditAfterData(c, await getNginxSiteDetail(input.name));
    return c.json(okBody(null, '站点已创建'), 200);
  },
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/:name',
    tags: ['Nginx站点'],
    summary: '更新 Nginx 站点配置内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description: '更新 Nginx 站点配置', module: 'Nginx 站点' } })] as const,
    request: {
      params: SiteNameParam,
      body: { content: jsonContent(UpdateNginxSiteContentDTO), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('配置已保存') },
  }),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    const { content } = c.req.valid('json');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await updateNginxSiteContent(name, content);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '配置已保存'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/:name',
    tags: ['Nginx站点'],
    summary: '删除 Nginx 站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description: '删除 Nginx 站点', module: 'Nginx 站点' } })] as const,
    request: { params: SiteNameParam },
    responses: { ...commonErrorResponses, ...okMsg('站点已删除') },
  }),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await deleteNginxSite(name);
    setAuditAfterData(c, { name, deleted: true });
    return c.json(okBody(null, '站点已删除'), 200);
  },
});

const enableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/:name/enable',
    tags: ['Nginx站点'],
    summary: '启用 Nginx 站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description: '启用 Nginx 站点', module: 'Nginx 站点' } })] as const,
    request: { params: SiteNameParam },
    responses: { ...commonErrorResponses, ...okMsg('站点已启用') },
  }),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await enableNginxSite(name);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '站点已启用'), 200);
  },
});

const disableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/:name/disable',
    tags: ['Nginx站点'],
    summary: '禁用 Nginx 站点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description: '禁用 Nginx 站点', module: 'Nginx 站点' } })] as const,
    request: { params: SiteNameParam },
    responses: { ...commonErrorResponses, ...okMsg('站点已禁用') },
  }),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await disableNginxSite(name);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '站点已禁用'), 200);
  },
});

router.openapiRoutes([
  infoRoute,
  listRoute,
  testRoute,
  reloadRoute,
  detailRoute,
  createRouteDef,
  updateRoute,
  deleteRoute,
  enableRoute,
  disableRoute,
] as const);

export default router;
