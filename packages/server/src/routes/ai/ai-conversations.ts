import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import {
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okCsv,
  csvStreamBody,
  IdParam,
  okBody,
  okPaginated,
  okFile,
  fileBody,
  PaginationQuery,
} from '../../lib/openapi-schemas';
import { AiConversationDTO, AiMessageDTO, AiFeedbackItemDTO, AiFeedbackContextDTO } from '../../lib/openapi-dtos';
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  listMessages,
  submitMessageFeedback,
  listFeedbackMessages,
  getFeedbackContext,
  exportFeedbackMessages,
  deleteMessage,
  deleteMessageCascade,
  renameConversation,
  togglePinConversation,
  toggleArchiveConversation,
  setConversationSystemPrompt,
  updateFeedbackStatus,
  exportConversation,
} from '../../services/ai/ai-conversations.service';
import { createAiConversationSchema, submitAiFeedbackSchema, updateAiFeedbackStatusSchema } from '@zenith/shared';
import { guard } from '../../middleware/guard';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ListQuery = z.object({
  archived: z.enum(['true', 'false']).optional().openapi({ description: '是否查看已归档对话' }),
  keyword: z.string().max(100).optional().openapi({ description: '搜索关键词（匹配标题或消息内容）' }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ description: '返回条数上限（分页加载）' }),
  offset: z.coerce.number().int().min(0).optional().openapi({ description: '偏移量（分页加载）' }),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['AI'],
    summary: '获取对话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...ok(z.array(AiConversationDTO), '对话列表') },
  }),
  handler: async (c) => {
    const { archived, keyword, limit, offset } = c.req.valid('query');
    return c.json(okBody(await listConversations({ archived: archived === 'true', keyword, limit, offset })), 200);
  },
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
      body: { content: jsonContent(submitAiFeedbackSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('反馈成功') },
  }),
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    const { feedback, reason } = c.req.valid('json');
    await submitMessageFeedback(id, msgId, feedback, reason);
    return c.json(okBody(null, '反馈成功'), 200);
  },
});

const FeedbackFilterFields = {
  feedback: z.enum(['1', '-1']).optional().openapi({ description: '反馈类型：1=点赞, -1=点踩' }),
  status: z.enum(['pending', 'resolved', 'ignored']).optional().openapi({ description: '处理状态筛选' }),
  model: z.string().max(100).optional().openapi({ description: '按模型筛选' }),
  startDate: z.string().max(20).optional().openapi({ description: '反馈时间起（YYYY-MM-DD）' }),
  endDate: z.string().max(20).optional().openapi({ description: '反馈时间止（YYYY-MM-DD）' }),
};

const FeedbackListQuery = PaginationQuery.extend(FeedbackFilterFields);

function parseFeedbackFilters(q: {
  feedback?: '1' | '-1';
  status?: 'pending' | 'resolved' | 'ignored';
  model?: string;
  startDate?: string;
  endDate?: string;
}) {
  return {
    feedback: q.feedback ? (Number(q.feedback) as 1 | -1) : undefined,
    status: q.status,
    model: q.model,
    startDate: q.startDate,
    endDate: q.endDate,
  };
}

const adminFeedbackList = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/admin/feedback',
    tags: ['AI'],
    summary: '管理员获取消息反馈列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:feedback:view' })] as const,
    request: { query: FeedbackListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AiFeedbackItemDTO, '反馈列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, ...filters } = c.req.valid('query');
    return c.json(okBody(await listFeedbackMessages({ page, pageSize, ...parseFeedbackFilters(filters) })), 200);
  },
});

const adminFeedbackContext = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/admin/feedback/{msgId}/context',
    tags: ['AI'],
    summary: '管理员查看反馈消息的会话上下文',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:feedback:view' })] as const,
    request: { params: z.object({ msgId: z.coerce.number() }) },
    responses: { ...commonErrorResponses, ...ok(AiFeedbackContextDTO, '上下文消息') },
  }),
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    return c.json(okBody(await getFeedbackContext(msgId)), 200);
  },
});

const adminFeedbackExport = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/admin/feedback/export',
    tags: ['AI'],
    summary: '管理员导出反馈列表 CSV',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:feedback:view', audit: { description: '导出 AI 反馈列表', module: '智能助手' } })] as const,
    request: { query: z.object(FeedbackFilterFields) },
    responses: { ...commonErrorResponses, ...okCsv('反馈列表 CSV') },
  }),
  handler: async (c) => {
    const filters = c.req.valid('query');
    const { stream, filename } = await exportFeedbackMessages(parseFeedbackFilters(filters));
    return csvStreamBody(c, stream, filename);
  },
});

const updateFeedback = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/admin/feedback/{msgId}',
    tags: ['AI'],
    summary: '管理员处理消息反馈（更新状态/备注）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:feedback:handle' })] as const,
    request: {
      params: z.object({ msgId: z.coerce.number() }),
      body: { content: jsonContent(updateAiFeedbackStatusSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('处理成功') },
  }),
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    const { status, remark } = c.req.valid('json');
    await updateFeedbackStatus(msgId, status, remark);
    return c.json(okBody(null, '处理成功'), 200);
  },
});

const exportConv = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/export',
    tags: ['AI'],
    summary: '导出对话（Markdown / JSON）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, query: z.object({ format: z.enum(['md', 'json']).default('md') }) },
    responses: { ...commonErrorResponses, ...okFile('对话文件') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    const { content, filename, contentType } = await exportConversation(id, format);
    return fileBody(content, filename, contentType);
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

const toggleArchive = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/archive',
    tags: ['AI'],
    summary: '归档/取消归档对话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.object({ isArchived: z.boolean() }), '操作成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const isArchived = await toggleArchiveConversation(id);
    return c.json(okBody({ isArchived }), 200);
  },
});

const setSystemPrompt = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/system-prompt',
    tags: ['AI'],
    summary: '设置对话级提示词（角色模板）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ systemPrompt: z.string().max(5000).nullable() })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(z.object({ systemPromptOverride: z.string().nullable() }), '设置成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { systemPrompt } = c.req.valid('json');
    const value = await setConversationSystemPrompt(id, systemPrompt);
    return c.json(okBody({ systemPromptOverride: value }), 200);
  },
});

router.openapiRoutes([list, create, getOne, remove, getMessages, rename, togglePin, toggleArchive, setSystemPrompt, exportConv, submitFeedback, deleteMsg, deleteMsgCascade, adminFeedbackList, adminFeedbackExport, adminFeedbackContext, updateFeedback] as const);

export default router;
