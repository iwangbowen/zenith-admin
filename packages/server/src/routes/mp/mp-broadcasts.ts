import { OpenAPIHono } from '@hono/zod-openapi';
import { mpBroadcastContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpBroadcasts, createMpBroadcast, updateMpBroadcast, deleteMpBroadcast, sendMpBroadcast, getMpBroadcastBeforeAudit,
  previewMpBroadcast, getMpBroadcastResult,
} from '../../services/mp/mp-broadcast.service';

const mpBroadcastsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:broadcast:list' })] as const;

const listRoute = defineContractRoute(mpBroadcastContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpBroadcasts(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(mpBroadcastContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:broadcast:create', audit: { description: '创建公众号群发', module: '公众号群发' } })],
  handler: async (c) => c.json(okBody(await createMpBroadcast(c.req.valid('json')), '已创建群发草稿'), 200),
});

const updateRoute = defineContractRoute(mpBroadcastContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:broadcast:update', audit: { description: '更新公众号群发', module: '公众号群发' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    return c.json(okBody(await updateMpBroadcast(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const sendRoute = defineContractRoute(mpBroadcastContract.send, {
  middleware: [
    authMiddleware,
    guard({ permission: 'mp:broadcast:send', audit: { description: '发送公众号群发', module: '公众号群发' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    return c.json(okBody(await sendMpBroadcast(id), '发送成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpBroadcastContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:broadcast:delete', audit: { description: '删除公众号群发', module: '公众号群发' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    await deleteMpBroadcast(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const previewRoute = defineContractRoute(mpBroadcastContract.preview, {
  middleware: [authMiddleware, guard({ permission: 'mp:broadcast:send', audit: { description: '群发预览', module: '公众号群发' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    await previewMpBroadcast(id, c.req.valid('json').openid);
    return c.json(okBody(null, '预览已发送'), 200);
  },
});

const resultRoute = defineContractRoute(mpBroadcastContract.result, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpBroadcastResult(c.req.valid('param').id)), 200),
});

mpBroadcastsRouter.openapiRoutes([listRoute, createRouteDef, updateRoute, sendRoute, previewRoute, resultRoute, deleteRoute] as const);

export default mpBroadcastsRouter;
