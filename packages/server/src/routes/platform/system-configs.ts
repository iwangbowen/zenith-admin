import { OpenAPIHono } from '@hono/zod-openapi';
import { systemConfigContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { getPasswordPolicy } from '../../lib/password-policy';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getPublicConfig,
  listSystemConfigs,
  createSystemConfig,
  updateSystemConfig,
  deleteSystemConfig,
  getSystemConfigBeforeAudit,
  getSystemConfig,
} from '../../services/platform/system-configs.service';

const systemConfigsRoute = new OpenAPIHono({ defaultHook: validationHook });

const publicGetRoute = defineContractRoute(systemConfigContract.publicByKey, {
  middleware: [],
  handler: async (c) => c.json(okBody(await getPublicConfig(c.req.valid('param').key)), 200),
});

const passwordPolicyRoute = defineContractRoute(systemConfigContract.passwordPolicy, {
  middleware: [],
  handler: async (c) => c.json(okBody(await getPasswordPolicy(), 'success'), 200),
});

const listRoute = defineContractRoute(systemConfigContract.list, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listSystemConfigs(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(systemConfigContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'system:config:list' })],
  handler: async (c) => c.json(okBody(await getSystemConfig(c.req.valid('param').id)), 200),
});

const createConfigRoute = defineContractRoute(systemConfigContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:config:create', audit: { module: '系统配置', description: '新增配置' } })],
  handler: async (c) => c.json(okBody(await createSystemConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateConfigRoute = defineContractRoute(systemConfigContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:config:update', audit: { module: '系统配置', description: '更新配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSystemConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateSystemConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(systemConfigContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:config:delete', audit: { module: '系统配置', description: '删除配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSystemConfigBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteSystemConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

systemConfigsRoute.openapiRoutes([publicGetRoute, passwordPolicyRoute, listRoute, getOneRoute, createConfigRoute, updateConfigRoute, deleteRouteDef] as const);

export default systemConfigsRoute;
