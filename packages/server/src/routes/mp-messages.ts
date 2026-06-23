import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okBody,
} from '../lib/openapi-schemas';
import { sendMpMessageSchema } from '@zenith/shared';
import { MpMessageDTO, MpConversationDTO } from '../lib/openapi-dtos';
import { listMessages, listConversations, sendCustomMessage } from '../services/mp-message.service';

const mpMessagesRouter = new OpenAPIHono({ defaultHook: validationHook });

const conversationsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/conversations', tags: ['公众号消息'], summary: '会话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:message:list' })] as const,
    request: { query: z.object({ accountId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(MpConversationDTO), '会话列表') },
  }),
  handler: async (c) => c.json(okBody(await listConversations(c.req.valid('query').accountId)), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号消息'], summary: '消息列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:message:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        openid: z.string().optional(),
        direction: z.enum(['in', 'out']).optional(),
        msgType: z.enum(['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link', 'event']).optional(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpMessageDTO, '消息列表') },
  }),
  handler: async (c) => c.json(okBody(await listMessages(c.req.valid('query'))), 200),
});

const sendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/send', tags: ['公众号消息'], summary: '发送客服消息',
    description: '向粉丝下发客服文本消息（需用户最近 48 小时内有交互），成功后落库为出站消息。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:message:send', audit: { description: '发送客服消息', module: '公众号消息' } })] as const,
    request: { body: { content: jsonContent(sendMpMessageSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpMessageDTO, '发送成功') },
  }),
  handler: async (c) => c.json(okBody(await sendCustomMessage(c.req.valid('json')), '发送成功'), 200),
});

mpMessagesRouter.openapiRoutes([conversationsRoute, listRoute, sendRoute] as const);

export default mpMessagesRouter;
