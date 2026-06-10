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
  okPaginated,
  PaginationQuery,
} from '../lib/openapi-schemas';
import { AiConversationDTO, AiMessageDTO } from '../lib/openapi-dtos';
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  listMessages,
  submitMessageFeedback,
  listFeedbackMessages,
  deleteMessage,
  deleteMessageCascade,
  renameConversation,
  togglePinConversation,
} from '../services/ai-conversations.service';
import { createAiConversationSchema } from '@zenith/shared';
import { guard } from '../middleware/guard';

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

const feedbackSchema = z.object({
  feedback: z.union([z.literal(1), z.literal(-1), z.null()]).openapi({ description: '1=点赞, -1=点踩, null=撤销' }),
});

const submitFeedback = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/messages/{msgId}/feedback',
    tags: ['AI'],
    summary: '提交消息反馈（点赞/点踩）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.coerce.number(), msgId: z.coerce.number() }),
      body: { content: jsonContent(feedbackSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('反馈成功') },
  }),
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    const { feedback } = c.req.valid('json');
    await submitMessageFeedback(id, msgId, feedback);
    return c.json(okBody(null, '反馈成功'), 200);
  },
});

const adminFeedbackList = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/admin/feedback',
    tags: ['AI'],
    summary: '管理员获取消息反馈列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:feedback:view' })] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AiMessageDTO, '反馈列表') },
  }),
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listFeedbackMessages(page, pageSize)), 200);
  },
});

const deleteMsg = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}/messages/{msgId}',
    tags: ['AI'],
    summary: '删除 assistant 消息（用于重新生成）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ id: z.coerce.number(), msgId: z.coerce.number() }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    await deleteMessage(id, msgId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteMsgCascade = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}/messages/{msgId}/cascade',
    tags: ['AI'],
    summary: '删除消息及其之后所有消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ id: z.coerce.number(), msgId: z.coerce.number() }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    await deleteMessageCascade(id, msgId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const rename = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/rename',
    tags: ['AI'],
    summary: '重命名对话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ title: z.string().min(1).max(200) })), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('重命名成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { title } = c.req.valid('json');
    await renameConversation(id, title);
    return c.json(okBody(null, '重命名成功'), 200);
  },
});

const togglePin = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/pin',
    tags: ['AI'],
    summary: '置顶/取消置顶对话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.object({ isPinned: z.boolean() }), '操作成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const isPinned = await togglePinConversation(id);
    return c.json(okBody({ isPinned }), 200);
  },
});

router.openapiRoutes([list, create, getOne, remove, getMessages, rename, togglePin, submitFeedback, deleteMsg, deleteMsgCascade, adminFeedbackList] as const);

export default router;
