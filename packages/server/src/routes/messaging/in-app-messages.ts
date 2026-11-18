import { OpenAPIHono } from '@hono/zod-openapi';
import { inAppMessageContract } from '@zenith/shared/messaging';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
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
  handler: async (c) => c.json(okBody(await listMyInAppMessages(c.req.valid('query'))), 200),
});

const unreadCountRoute = defineContractRoute(inAppMessageContract.unreadCount, {
  handler: async (c) => c.json(okBody(await unreadCount(c.req.valid('query'))), 200),
});

const detailRoute = defineContractRoute(inAppMessageContract.detail, {
  handler: async (c) => c.json(okBody(await getMyInAppMessage(c.req.valid('param').id)), 200),
});

const sendRoute = defineContractRoute(inAppMessageContract.send, {
  handler: async (c) => c.json(okBody(await sendInApp(c.req.valid('json')), '发送成功'), 200),
});

const markReadRoute = defineContractRoute(inAppMessageContract.markRead, {
  handler: async (c) => {
    await markAsRead(c.req.valid('param').id);
    return c.json(okBody(null, '已标记'), 200);
  },
});

const markAllReadRoute = defineContractRoute(inAppMessageContract.markAllRead, {
  handler: async (c) => {
    const result = await markAllAsRead(c.req.valid('json'));
    return c.json(okBody(result, '已全部标记'), 200);
  },
});

const batchReadRoute = defineContractRoute(inAppMessageContract.markReadBatch, {
  handler: async (c) => {
    const { count } = await batchMarkAsRead(c.req.valid('json').ids);
    return c.json(okBody(null, `已标记 ${count} 条为已读`), 200);
  },
});

const batchDeleteRoute = defineContractRoute(inAppMessageContract.removeBatch, {
  handler: async (c) => {
    const { count } = await batchDeleteInAppMessages(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 条消息`), 200);
  },
});

const deleteRoute = defineContractRoute(inAppMessageContract.remove, {
  handler: async (c) => {
    await deleteInAppMessage(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const adminListRoute = defineContractRoute(inAppMessageContract.adminList, {
  handler: async (c) => c.json(okBody(await listAllInAppMessages(c.req.valid('query'))), 200),
});

const adminMarkAllReadRoute = defineContractRoute(inAppMessageContract.adminMarkAllRead, {
  handler: async (c) => {
    const result = await adminMarkAllAsRead();
    setAuditAfterData(c, result);
    return c.json(okBody(null, '已全部标记'), 200);
  },
});

const adminMarkReadRoute = defineContractRoute(inAppMessageContract.adminMarkRead, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppMessageBeforeAudit(id));
    await adminMarkAsRead(id);
    return c.json(okBody(null, '已标记'), 200);
  },
});

const adminDeleteRoute = defineContractRoute(inAppMessageContract.adminRemove, {
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
