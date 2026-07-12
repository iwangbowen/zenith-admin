import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { sendInAppSchema, IN_APP_MESSAGE_TYPES } from '@zenith/shared';
import { InAppMessageDTO, InAppSendResultDTO, UnreadCountDTO } from '../../lib/openapi-dtos';
import {
  listMyInAppMessages, getMyInAppMessage, markAsRead, markAllAsRead, unreadCount,
  deleteInAppMessage, sendInApp, batchMarkAsRead, batchDeleteInAppMessages,
  listAllInAppMessages, adminDeleteInAppMessage, adminMarkAsRead, adminMarkAllAsRead,
  getInAppMessageBeforeAudit,
} from '../../services/messaging/in-app-messages.service';

const inAppMessagesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['InAppMessages'], summary: '我的站内信列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        type: z.enum(IN_APP_MESSAGE_TYPES).optional(),
        isRead: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(InAppMessageDTO, '站内信列表') },
  }),
  handler: async (c) => c.json(okBody(await listMyInAppMessages(c.req.valid('query'))), 200),
});

const unreadCountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/unread-count', tags: ['InAppMessages'], summary: '未读消息数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(UnreadCountDTO, '未读消息数') },
  }),
  handler: async (c) => c.json(okBody(await unreadCount()), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['InAppMessages'], summary: '我的站内信详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(InAppMessageDTO, '站内信详情') },
  }),
  handler: async (c) => c.json(okBody(await getMyInAppMessage(c.req.valid('param').id)), 200),
});

const sendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/send', tags: ['InAppMessages'], summary: '发送站内信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:in-app-template:list',
      audit: { description: '发送站内信', module: '收件记录' },
    })] as const,
    request: { body: { content: jsonContent(sendInAppSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(InAppSendResultDTO, '发送结果') },
  }),
  handler: async (c) => c.json(okBody(await sendInApp(c.req.valid('json')), '发送成功'), 200),
});

const markReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/read', tags: ['InAppMessages'], summary: '标记为已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:read' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已标记') },
  }),
  handler: async (c) => {
    await markAsRead(c.req.valid('param').id);
    return c.json(okBody(null, '已标记'), 200);
  },
});

const markAllReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/read-all', tags: ['InAppMessages'], summary: '全部标记为已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:read' })] as const,
    responses: { ...commonErrorResponses, ...okMsg('已全部标记') },
  }),
  handler: async (c) => {
    await markAllAsRead();
    return c.json(okBody(null, '已全部标记'), 200);
  },
});

const batchReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-read', tags: ['InAppMessages'], summary: '批量标记为已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:read' })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已标记') },
  }),
  handler: async (c) => {
    const { count } = await batchMarkAsRead(c.req.valid('json').ids);
    return c.json(okBody(null, `已标记 ${count} 条为已读`), 200);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['InAppMessages'], summary: '批量删除站内信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:delete' })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { count } = await batchDeleteInAppMessages(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 条消息`), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['InAppMessages'], summary: '删除站内信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:delete' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteInAppMessage(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const adminListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/admin', tags: ['InAppMessages'], summary: '管理员视角：全部站内信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        type: z.enum(IN_APP_MESSAGE_TYPES).optional(),
        isRead: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
        recipientId: z.coerce.number().int().positive().optional(),
        senderId: z.coerce.number().int().positive().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(InAppMessageDTO, '管理员视角站内信列表') },
  }),
  handler: async (c) => c.json(okBody(await listAllInAppMessages(c.req.valid('query'))), 200),
});

const adminMarkAllReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/admin/read-all', tags: ['InAppMessages'], summary: '管理员：全部标记为已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:in-app-message:read',
      audit: { description: '管理员全部标记站内信已读', module: '收件记录' },
    })] as const,
    responses: { ...commonErrorResponses, ...okMsg('已全部标记') },
  }),
  handler: async (c) => {
    const result = await adminMarkAllAsRead();
    setAuditAfterData(c, result);
    return c.json(okBody(null, '已全部标记'), 200);
  },
});

const adminMarkReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/admin/{id}/read', tags: ['InAppMessages'], summary: '管理员：标记任意站内信为已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:in-app-message:read',
      audit: { description: '管理员标记站内信已读', module: '收件记录' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已标记') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppMessageBeforeAudit(id));
    await adminMarkAsRead(id);
    return c.json(okBody(null, '已标记'), 200);
  },
});

const adminDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/admin/{id}', tags: ['InAppMessages'], summary: '管理员：删除任意站内信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({
      permission: 'system:in-app-message:delete',
      audit: { description: '管理员删除站内信', module: '收件记录' },
    })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
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
