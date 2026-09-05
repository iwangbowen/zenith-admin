/**
 * 运营群发路由（管理员）。发送动作提交任务中心任务，进度经通用 /api/async-tasks 查询。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { broadcastContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  getBroadcastBeforeAudit,
  listBroadcasts,
  sendBroadcast,
  updateBroadcast,
} from '../../services/messaging/broadcasts.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:broadcast:list' })] as const;

const listRoute = defineContractRoute(broadcastContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listBroadcasts(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(broadcastContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getBroadcast(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(broadcastContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'system:broadcast:create',
    audit: { description: '创建群发活动', module: '运营群发' },
  })],
  handler: async (c) => c.json(okBody(await createBroadcast(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(broadcastContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'system:broadcast:update',
    audit: { description: '更新群发活动', module: '运营群发' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getBroadcastBeforeAudit(id));
    return c.json(okBody(await updateBroadcast(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(broadcastContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'system:broadcast:delete',
    audit: { description: '删除群发活动', module: '运营群发' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getBroadcastBeforeAudit(id));
    await deleteBroadcast(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const sendRoute = defineContractRoute(broadcastContract.send, {
  middleware: [authMiddleware, guard({
    permission: 'system:broadcast:send',
    audit: { description: '发送群发活动', module: '运营群发' },
  })],
  handler: async (c) => c.json(okBody(await sendBroadcast(c.req.valid('param').id), '任务已提交'), 200),
});

router.openapiRoutes([listRoute, detailRoute, createRouteDef, updateRouteDef, deleteRoute, sendRoute] as const);

export default router;
