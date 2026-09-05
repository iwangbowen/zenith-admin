import { OpenAPIHono } from '@hono/zod-openapi';
import { mpMenuContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMpMenu, saveMpMenu, publishMpMenu, pullMpMenu, deleteMpMenu } from '../../services/mp/mp-menu.service';

const mpMenuRouter = new OpenAPIHono({ defaultHook: validationHook });

const getRoute = defineContractRoute(mpMenuContract.get, {
  middleware: [authMiddleware, guard({ permission: 'mp:menu:list' })],
  handler: async (c) => c.json(okBody(await getMpMenu(c.req.valid('query').accountId)), 200),
});

const saveRoute = defineContractRoute(mpMenuContract.save, {
  middleware: [authMiddleware, guard({ permission: 'mp:menu:save', audit: { description: '保存公众号菜单', module: '公众号菜单' } })],
  handler: async (c) => {
    const { accountId, buttons } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await saveMpMenu(accountId, buttons), '保存成功'), 200);
  },
});

const publishRoute = defineContractRoute(mpMenuContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'mp:menu:publish', audit: { description: '发布公众号菜单', module: '公众号菜单' } })],
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await publishMpMenu(accountId), '发布成功'), 200);
  },
});

const pullRoute = defineContractRoute(mpMenuContract.pull, {
  middleware: [authMiddleware, guard({ permission: 'mp:menu:pull', audit: { description: '拉取公众号菜单', module: '公众号菜单' } })],
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await pullMpMenu(accountId), '拉取成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpMenuContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:menu:delete', audit: { description: '删除公众号菜单', module: '公众号菜单' } })],
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpMenu(accountId));
    return c.json(okBody(await deleteMpMenu(accountId), '删除成功'), 200);
  },
});

mpMenuRouter.openapiRoutes([getRoute, saveRoute, publishRoute, pullRoute, deleteRoute] as const);

export default mpMenuRouter;
