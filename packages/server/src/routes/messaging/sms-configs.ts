import { OpenAPIHono } from '@hono/zod-openapi';
import { smsConfigContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSmsConfigs, getSmsConfig, createSmsConfig, updateSmsConfig,
  deleteSmsConfig, getSmsConfigBeforeAudit, setSmsConfigDefault,
} from '../../services/messaging/sms-configs.service';

const smsConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:sms-config:list' })] as const;

const listRoute = defineContractRoute(smsConfigContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listSmsConfigs(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(smsConfigContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getSmsConfig(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(smsConfigContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-config:create', audit: { description: '创建短信配置', module: '短信配置' } })],
  handler: async (c) => c.json(okBody(await createSmsConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(smsConfigContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-config:update', audit: { description: '更新短信配置', module: '短信配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    return c.json(okBody(await updateSmsConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(smsConfigContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-config:delete', audit: { description: '删除短信配置', module: '短信配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    await deleteSmsConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const setDefaultRoute = defineContractRoute(smsConfigContract.setDefault, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-config:default', audit: { description: '设为默认短信配置', module: '短信配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    return c.json(okBody(await setSmsConfigDefault(id), '操作成功'), 200);
  },
});

smsConfigsRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, setDefaultRoute, deleteRoute] as const);

export default smsConfigsRouter;
