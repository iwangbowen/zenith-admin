/**
 * App 推送配置（管理侧）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { pushConfigContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createPushConfig,
  deletePushConfig,
  getPushConfig,
  getPushConfigBeforeAudit,
  listPushConfigs,
  testPushSend,
  updatePushConfig,
} from '../../services/messaging/push-configs.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:push:list' })] as const;

const listRoute = defineContractRoute(pushConfigContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listPushConfigs(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(pushConfigContract.detail, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getPushConfig(id)), 200);
  },
});

const createRoute = defineContractRoute(pushConfigContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'system:push:create',
    audit: { description: '创建推送配置', module: '推送管理', recordBody: false },
  })],
  handler: async (c) => c.json(okBody(await createPushConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(pushConfigContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'system:push:update',
    audit: { description: '更新推送配置', module: '推送管理', recordBody: false },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getPushConfigBeforeAudit(id));
    return c.json(okBody(await updatePushConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(pushConfigContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'system:push:delete',
    audit: { description: '删除推送配置', module: '推送管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getPushConfigBeforeAudit(id));
    await deletePushConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const testSendRoute = defineContractRoute(pushConfigContract.testSend, {
  middleware: [authMiddleware, guard({
    permission: 'system:push:send',
    audit: { description: '测试推送', module: '推送管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testPushSend(id, c.req.valid('json')), '发送成功'), 200);
  },
});

router.openapiRoutes([
  listRoute,
  getOneRoute,
  createRoute,
  updateRoute,
  deleteRoute,
  testSendRoute,
] as const);

export default router;
