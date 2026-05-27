import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  IdParam,
  okBody,
} from '../lib/openapi-schemas';
import { AiConversationDTO, AiMessageDTO } from '../lib/openapi-dtos';
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  listMessages,
} from '../services/ai-conversations.service';
import { createAiConversationSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取对话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(AiConversationDTO), '对话列表') },
  }),
  handler: async (c) => c.json(okBody(await listConversations()), 200),
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['AI'],
    summary: '新建对话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(createAiConversationSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(AiConversationDTO, '创建成功') },
  }),
  handler: async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(okBody(await createConversation(body ?? {})), 200);
  },
});

const getOne = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['AI'],
    summary: '获取对话详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiConversationDTO, '对话详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getConversation(id)), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['AI'],
    summary: '删除对话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteConversation(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const getMessages = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/messages',
    tags: ['AI'],
    summary: '获取对话消息历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(AiMessageDTO), '消息列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listMessages(id)), 200);
  },
});

router.openapiRoutes([list, create, getOne, remove, getMessages] as const);

export default router;
