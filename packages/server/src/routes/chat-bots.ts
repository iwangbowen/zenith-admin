import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody,
  PaginationQuery,
} from '../lib/openapi-schemas';
import { ChatWebhookDTO } from '../lib/openapi-dtos';
import { createChatWebhookSchema, updateChatWebhookSchema } from '@zenith/shared';
import {
  listChatWebhooks, createChatWebhook, updateChatWebhook, deleteChatWebhook, regenerateChatWebhookToken,
} from '../services/chat-webhooks.service';

const chatBotsRoute = new OpenAPIHono({ defaultHook: validationHook });

const MODULE = '聊天机器人';

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['ChatBots'], summary: '获取 Webhook 机器人列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'chat:bot:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(ChatWebhookDTO, 'Webhook 列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, keyword } = c.req.valid('query');
    return c.json(okBody(await listChatWebhooks({ page, pageSize, keyword })), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['ChatBots'], summary: '创建 Webhook 机器人',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'chat:bot:create', audit: { description: '创建聊天 Webhook', module: MODULE } })] as const,
    request: { body: { content: jsonContent(createChatWebhookSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChatWebhookDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createChatWebhook(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'patch', path: '/{id}', tags: ['ChatBots'], summary: '更新 Webhook 机器人',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'chat:bot:update', audit: { description: '更新聊天 Webhook', module: MODULE } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateChatWebhookSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChatWebhookDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateChatWebhook(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const regenerate = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/regenerate-token', tags: ['ChatBots'], summary: '重置 Webhook 令牌',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'chat:bot:update', audit: { description: '重置聊天 Webhook 令牌', module: MODULE } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ChatWebhookDTO, '重置成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await regenerateChatWebhookToken(id), '令牌已重置'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['ChatBots'], summary: '删除 Webhook 机器人',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'chat:bot:delete', audit: { description: '删除聊天 Webhook', module: MODULE } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteChatWebhook(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

chatBotsRoute.openapiRoutes([list, create, update, regenerate, remove] as const);

export default chatBotsRoute;
