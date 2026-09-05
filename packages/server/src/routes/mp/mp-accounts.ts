import { OpenAPIHono } from '@hono/zod-openapi';
import { mpAccountContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpAccounts, getMpAccount, createMpAccount, updateMpAccount,
  deleteMpAccount, getMpAccountBeforeAudit, setMpAccountDefault, testMpAccountConnection, getMpAccountDefaultAudit,
} from '../../services/mp/mp-account.service';

const mpAccountsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:account:list' })] as const;

const listRoute = defineContractRoute(mpAccountContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpAccounts(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(mpAccountContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpAccount(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(mpAccountContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:account:create', audit: { description: '创建公众号', module: '公众号管理' } })],
  handler: async (c) => c.json(okBody(await createMpAccount(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(mpAccountContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:account:update', audit: { description: '更新公众号', module: '公众号管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAccountBeforeAudit(id));
    return c.json(okBody(await updateMpAccount(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const setDefaultRoute = defineContractRoute(mpAccountContract.setDefault, {
  middleware: [authMiddleware, guard({ permission: 'mp:account:default', audit: { description: '设为默认公众号', module: '公众号管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAccountDefaultAudit(id));
    const updated = await setMpAccountDefault(id);
    setAuditAfterData(c, await getMpAccountDefaultAudit(id));
    return c.json(okBody(updated, '操作成功'), 200);
  },
});

const testConnectionRoute = defineContractRoute(mpAccountContract.testConnection, {
  middleware: [authMiddleware, guard({ permission: 'mp:account:token', audit: { description: '测试公众号连接', module: '公众号管理' } })],
  handler: async (c) => c.json(okBody(await testMpAccountConnection(c.req.valid('param').id), '连接成功'), 200),
});

const deleteRoute = defineContractRoute(mpAccountContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:account:delete', audit: { description: '删除公众号', module: '公众号管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAccountBeforeAudit(id));
    await deleteMpAccount(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpAccountsRouter.openapiRoutes([
  listRoute, getRoute, createRouteDef, updateRoute, setDefaultRoute, testConnectionRoute, deleteRoute,
] as const);

export default mpAccountsRouter;
