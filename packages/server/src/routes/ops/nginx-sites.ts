import { OpenAPIHono } from '@hono/zod-openapi';
import { nginxSiteContract } from '@zenith/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
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
} from '../../services/ops/nginx-sites.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:nginx:view' })] as const;
const manage = (description: string) => [authMiddleware, guard({ permission: 'system:nginx:manage', audit: { description, module: 'Nginx 站点' } })] as const;

const infoRoute = defineContractRoute(nginxSiteContract.info, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getNginxInfo()), 200),
});

const listRoute = defineContractRoute(nginxSiteContract.list, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listNginxSites()), 200),
});

const testRoute = defineContractRoute(nginxSiteContract.test, {
  middleware: manage('测试 Nginx 配置'),
  handler: async (c) => c.json(okBody(await testNginxConfig()), 200),
});

const reloadRoute = defineContractRoute(nginxSiteContract.reload, {
  middleware: [authMiddleware, guard({ permission: 'system:nginx:reload', audit: { description: '重载 Nginx', module: 'Nginx 站点' } })],
  handler: async (c) => {
    await reloadNginx();
    return c.json(okBody(null, 'Nginx 已重载'), 200);
  },
});

const detailRoute = defineContractRoute(nginxSiteContract.detail, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getNginxSiteDetail(c.req.valid('param').name)), 200),
});

const createRouteDef = defineContractRoute(nginxSiteContract.create, {
  middleware: manage('创建 Nginx 站点'),
  handler: async (c) => {
    const input = c.req.valid('json');
    await createNginxSite(input);
    setAuditAfterData(c, await getNginxSiteDetail(input.name));
    return c.json(okBody(null, '站点已创建'), 200);
  },
});

const updateRoute = defineContractRoute(nginxSiteContract.update, {
  middleware: manage('更新 Nginx 站点配置'),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    const { content } = c.req.valid('json');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await updateNginxSiteContent(name, content);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '配置已保存'), 200);
  },
});

const deleteRoute = defineContractRoute(nginxSiteContract.remove, {
  middleware: manage('删除 Nginx 站点'),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await deleteNginxSite(name);
    setAuditAfterData(c, { name, deleted: true });
    return c.json(okBody(null, '站点已删除'), 200);
  },
});

const enableRoute = defineContractRoute(nginxSiteContract.enable, {
  middleware: manage('启用 Nginx 站点'),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await enableNginxSite(name);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '站点已启用'), 200);
  },
});

const disableRoute = defineContractRoute(nginxSiteContract.disable, {
  middleware: manage('禁用 Nginx 站点'),
  handler: async (c) => {
    const { name } = c.req.valid('param');
    setAuditBeforeData(c, await getNginxSiteDetail(name));
    await disableNginxSite(name);
    setAuditAfterData(c, await getNginxSiteDetail(name));
    return c.json(okBody(null, '站点已禁用'), 200);
  },
});

// 静态 /info /test /reload 先于动态 /{name} 注册
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
