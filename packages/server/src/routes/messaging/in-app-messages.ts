import { OpenAPIHono } from '@hono/zod-openapi';
import { inAppMessageContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMyInAppMessages, getMyInAppMessage, markAsRead, markAllAsRead, unreadCount,
  deleteInAppMessage, sendInApp, batchMarkAsRead, batchDeleteInAppMessages,
  listAllInAppMessages, adminDeleteInAppMessage, adminMarkAsRead, adminMarkAllAsRead,
  getInAppMessageBeforeAudit,
} from '../../services/messaging/in-app-messages.service';

const inAppMessagesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(inAppMessageContract.list, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listMyInAppMessages(c.req.valid('query'))), 200),
});

const unreadCountRoute = defineContractRoute(inAppMessageContract.unreadCount, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await unreadCount()), 200),
});

const detailRoute = defineContractRoute(inAppMessageContract.detail, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await getMyInAppMessage(c.req.valid('param').id)), 200),
});

const sendRoute = defineContractRoute(inAppMessageContract.send, {
  middleware: [authMiddleware, guard({
    permission: 'system:in-app-template:list',
    audit: { description: '发送站内信', module: '收件记录' },
  })],
  handler: async (c) => c.json(okBody(await sendInApp(c.req.valid('json')), '发送成功'), 200),
});

const markReadRoute = defineContractRoute(inAppMessageContract.markRead, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-message:read' })],
  handler: async (c) => {
    await markAsRead(c.req.valid('param').id);
    return c.json(okBody(null, '已标记'), 200);
  },
});

const markAllReadRoute = defineContractRoute(inAppMessageContract.markAllRead, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-message:read' })],
  handler: async (c) => {
    await markAllAsRead();
    return c.json(okBody(null, '已全部标记'), 200);
  },
});

const batchReadRoute = defineContractRoute(inAppMessageContract.markReadBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-message:read' })],
  handler: async (c) => {
    const { count } = await batchMarkAsRead(c.req.valid('json').ids);
    return c.json(okBody(null, `已标记 ${count} 条为已读`), 200);
  },
});

const batchDeleteRoute = defineContractRoute(inAppMessageContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-message:delete' })],
  handler: async (c) => {
    const { count } = await batchDeleteInAppMessages(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 条消息`), 200);
  },
});

const deleteRoute = defineContractRoute(inAppMessageContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-message:delete' })],
  handler: async (c) => {
    await deleteInAppMessage(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const adminListRoute = defineContractRoute(inAppMessageContract.adminList, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-message:list' })],
  handler: async (c) => c.json(okBody(await listAllInAppMessages(c.req.valid('query'))), 200),
});

const adminMarkAllReadRoute = defineContractRoute(inAppMessageContract.adminMarkAllRead, {
  middleware: [authMiddleware, guard({
    permission: 'system:in-app-message:read',
    audit: { description: '管理员全部标记站内信已读', module: '收件记录' },
  })],
  handler: async (c) => {
    const result = await adminMarkAllAsRead();
    setAuditAfterData(c, result);
    return c.json(okBody(null, '已全部标记'), 200);
  },
});

const adminMarkReadRoute = defineContractRoute(inAppMessageContract.adminMarkRead, {
  middleware: [authMiddleware, guard({
    permission: 'system:in-app-message:read',
    audit: { description: '管理员标记站内信已读', module: '收件记录' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppMessageBeforeAudit(id));
    await adminMarkAsRead(id);
    return c.json(okBody(null, '已标记'), 200);
  },
});

const adminDeleteRoute = defineContractRoute(inAppMessageContract.adminRemove, {
  middleware: [authMiddleware, guard({
    permission: 'system:in-app-message:delete',
    audit: { description: '管理员删除站内信', module: '收件记录' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppMessageBeforeAudit(id));
    await adminDeleteInAppMessage(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

inAppMessagesRouter.openapiRoutes([
  listRoute, adminListRoute, adminMarkAllReadRoute, adminMarkReadRoute, adminDeleteRoute,
  unreadCountRoute, sendRoute, markAllReadRoute, batchReadRoute, batchDeleteRoute,
  detailRoute, markReadRoute, deleteRoute,
] as const);

export default inAppMessagesRouter;
