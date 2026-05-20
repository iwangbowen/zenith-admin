import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { sendInAppSchema, IN_APP_MESSAGE_TYPES } from '@zenith/shared';
import { InAppMessageDTO, InAppSendResultDTO, UnreadCountDTO } from '../lib/openapi-dtos';
import {
  listMyInAppMessages, markAsRead, markAllAsRead, unreadCount,
  deleteInAppMessage, sendInApp,
} from '../services/in-app-messages.service';

const inAppMessagesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['InAppMessages'], summary: '我的站内信列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-message:list' })] as const,
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

const sendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/send', tags: ['InAppMessages'], summary: '发送站内信',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-template:list' })] as const,
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

inAppMessagesRouter.openapiRoutes([listRoute, unreadCountRoute, sendRoute, markAllReadRoute, markReadRoute, deleteRoute] as const);

export default inAppMessagesRouter;
