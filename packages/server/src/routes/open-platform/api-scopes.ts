import { OpenAPIHono } from '@hono/zod-openapi';
import { apiScopeContract } from '@zenith/shared/open-platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listApiScopes,
  listEnabledApiScopes,
  getApiScope,
  getApiScopeBeforeAudit,
  createApiScope,
  updateApiScope,
  deleteApiScope,
  batchDeleteApiScopes,
} from '../../services/open-platform/api-scopes.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const MODULE = '开放平台-API Scope';
const read = [authMiddleware, guard({ permission: 'open:scope:view' })] as const;

const list = defineContractRoute(apiScopeContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listApiScopes(c.req.valid('query'))), 200),
});

const options = defineContractRoute(apiScopeContract.options, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listEnabledApiScopes()), 200),
});

const detail = defineContractRoute(apiScopeContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getApiScope(c.req.valid('param').id)), 200),
});

const create = defineContractRoute(apiScopeContract.create, {
  middleware: [authMiddleware, guard({ permission: 'open:scope:manage', audit: { description: '创建 API Scope', module: MODULE } })],
  handler: async (c) => c.json(okBody(await createApiScope(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(apiScopeContract.update, {
  middleware: [authMiddleware, guard({ permission: 'open:scope:manage', audit: { description: '更新 API Scope', module: MODULE } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApiScopeBeforeAudit(id));
    return c.json(okBody(await updateApiScope(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const batchDelete = defineContractRoute(apiScopeContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'open:scope:manage', audit: { description: '批量删除 API Scope', module: MODULE } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const n = await batchDeleteApiScopes(ids);
    return c.json(okBody(null, `已删除 ${n} 条记录`), 200);
  },
});

const remove = defineContractRoute(apiScopeContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'open:scope:manage', audit: { description: '删除 API Scope', module: MODULE } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getApiScopeBeforeAudit(id));
    await deleteApiScope(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, options, detail, create, update, batchDelete, remove] as const);

export default router;
