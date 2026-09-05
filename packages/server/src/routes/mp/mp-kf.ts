import { OpenAPIHono } from '@hono/zod-openapi';
import { mpKfAccountContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpKfAccounts, createMpKfAccount, updateMpKfAccount, deleteMpKfAccount, getMpKfAccountBeforeAudit, syncMpKfAccounts,
} from '../../services/mp/mp-kf.service';

const mpKfRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(mpKfAccountContract.list, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:list' })],
  handler: async (c) => c.json(okBody(await listMpKfAccounts(c.req.valid('query'))), 200),
});

const syncRoute = defineContractRoute(mpKfAccountContract.sync, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:sync', audit: { description: '同步客服账号', module: '公众号多客服' } })],
  handler: async (c) => c.json(okBody(await syncMpKfAccounts(c.req.valid('json').accountId), '同步完成'), 200),
});

const createRouteDef = defineContractRoute(mpKfAccountContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:create', audit: { description: '添加客服账号', module: '公众号多客服' } })],
  handler: async (c) => c.json(okBody(await createMpKfAccount(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(mpKfAccountContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:update', audit: { description: '修改客服账号', module: '公众号多客服' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpKfAccountBeforeAudit(id));
    return c.json(okBody(await updateMpKfAccount(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpKfAccountContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:delete', audit: { description: '删除客服账号', module: '公众号多客服' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpKfAccountBeforeAudit(id));
    await deleteMpKfAccount(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpKfRouter.openapiRoutes([listRoute, syncRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default mpKfRouter;
