import { OpenAPIHono } from '@hono/zod-openapi';
import { mpConditionalMenuContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpConditionalMenus, createMpConditionalMenu, updateMpConditionalMenu,
  deleteMpConditionalMenu, publishMpConditionalMenu, tryMatchMpMenu, getMpConditionalMenuBeforeAudit,
} from '../../services/mp/mp-conditional-menu.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:condmenu:list' })] as const;

const listRoute = defineContractRoute(mpConditionalMenuContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpConditionalMenus(c.req.valid('query').accountId)), 200),
});

const tryMatchRoute = defineContractRoute(mpConditionalMenuContract.tryMatch, {
  middleware: read,
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await tryMatchMpMenu(b.accountId, b.userId)), 200);
  },
});

const createRouteDef = defineContractRoute(mpConditionalMenuContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:condmenu:create', audit: { description: '新增个性化菜单', module: '公众号个性化菜单' } })],
  handler: async (c) => c.json(okBody(await createMpConditionalMenu(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(mpConditionalMenuContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:condmenu:update', audit: { description: '编辑个性化菜单', module: '公众号个性化菜单' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpConditionalMenuBeforeAudit(id));
    return c.json(okBody(await updateMpConditionalMenu(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const publishRoute = defineContractRoute(mpConditionalMenuContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'mp:condmenu:publish', audit: { description: '发布个性化菜单', module: '公众号个性化菜单' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpConditionalMenuBeforeAudit(id));
    return c.json(okBody(await publishMpConditionalMenu(id), '发布成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpConditionalMenuContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:condmenu:delete', audit: { description: '删除个性化菜单', module: '公众号个性化菜单' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpConditionalMenuBeforeAudit(id));
    await deleteMpConditionalMenu(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, tryMatchRoute, createRouteDef, updateRoute, publishRoute, deleteRoute] as const);

export default router;
