import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import {
  ChatMessageDTO, ChatConversationDTO, ChatUserDTO, ChatGroupMemberDTO, ChatLinkPreviewDTO, ChatMessageExtraDTO,
  ChatMessageSearchItemDTO, ChatMessageContextDTO,
} from '../lib/openapi-dtos';
import {
  listConversations, getOrCreateDirectConversation, listMessages,
  searchConversationMessages, getMessageContext,
  sendMessage, recallMessage, markConversationRead, listChatUsers,
  createGroupConversation, addGroupMember, listGroupMembers,
  removeGroupMember, updateGroupInfo, transferGroupOwnership,
  pinConversation, starConversation, removeConversation,
  getLinkPreview,
} from '../services/chat.service';

const chatRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 用户搜索（开始聊天前选对象） ────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/users', tags: ['Chat'], summary: '搜索可聊天的用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: z.object({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatUserDTO), '用户列表') },
  }),
  async (c) => {
    const { keyword } = c.req.valid('query');
    const list = await listChatUsers(keyword);
    return c.json(okBody(list), 200);
  },
);

// ─── 会话列表 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations', tags: ['Chat'], summary: '我的会话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChatConversationDTO), '会话列表') },
  }),
  async (c) => {
    const list = await listConversations();
    return c.json(okBody(list), 200);
  },
);

// ─── 创建/获取单聊会话 ────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/direct', tags: ['Chat'], summary: '创建或获取单聊会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(z.object({ targetUserId: z.number().int().positive() })) } },
    responses: { ...commonErrorResponses, ...ok(ChatConversationDTO, '会话信息') },
  }),
  async (c) => {
    const { targetUserId } = c.req.valid('json');
    const conv = await getOrCreateDirectConversation(targetUserId);
    return c.json(okBody(conv), 200);
  },
);

// ─── 会话消息列表 ─────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/messages', tags: ['Chat'], summary: '获取会话消息（分页）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ChatMessageDTO, '消息列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    const result = await listMessages(id, page, pageSize);
    return c.json(okBody(result), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/messages/search', tags: ['Chat'], summary: '搜索当前会话消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      query: z.object({
        keyword: z.string().optional(),
        types: z.string().optional(),
        senderId: z.coerce.number().int().positive().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(20),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({
        list: z.array(ChatMessageSearchItemDTO),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
      }), '搜索结果'),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    const result = await searchConversationMessages(id, {
      keyword: query.keyword,
      types: query.types ? (query.types.split(',').filter(Boolean) as Array<'text' | 'image' | 'file' | 'system'>) : undefined,
      senderId: query.senderId,
      startAt: query.startAt,
      endAt: query.endAt,
      page: query.page,
      pageSize: query.pageSize,
    });
    return c.json(okBody(result), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/messages/{messageId}/context', tags: ['Chat'], summary: '获取目标消息上下文',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({
        id: z.coerce.number().int().positive(),
        messageId: z.coerce.number().int().positive(),
      }),
      query: z.object({
        before: z.coerce.number().int().min(0).max(100).default(15),
        after: z.coerce.number().int().min(0).max(100).default(15),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(ChatMessageContextDTO, '消息上下文') },
  }),
  async (c) => {
    const { id, messageId } = c.req.valid('param');
    const { before, after } = c.req.valid('query');
    const result = await getMessageContext(id, messageId, before, after);
    return c.json(okBody(result), 200);
  },
);

// ─── 发送消息 ─────────────────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  content: z.string().min(1, '消息不能为空').max(4096),
  type: z.enum(['text', 'image', 'file']).default('text'),
  replyToId: z.number().int().positive().nullable().optional(),
  extra: ChatMessageExtraDTO.nullable().optional(),
});

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/link-preview', tags: ['Chat'], summary: '获取链接预览信息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      query: z.object({ url: z.url().max(2048) }),
    },
    responses: { ...commonErrorResponses, ...ok(ChatLinkPreviewDTO, '链接预览') },
  }),
  async (c) => {
    const { url } = c.req.valid('query');
    const data = await getLinkPreview(url);
    return c.json(okBody(data), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/messages', tags: ['Chat'], summary: '发送消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(sendMessageSchema) } },
    responses: { ...commonErrorResponses, ...ok(ChatMessageDTO, '消息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const msg = await sendMessage(id, body);
    return c.json(okBody(msg), 200);
  },
);

// ─── 撤回消息 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/messages/{id}/recall', tags: ['Chat'], summary: '撤回消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('撤回成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await recallMessage(id);
    return c.json(okBody(null), 200);
  },
);

// ─── 标记已读 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/read', tags: ['Chat'], summary: '标记会话已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已读') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await markConversationRead(id);
    return c.json(okBody(null), 200);
  },
);

// ─── 创建群聊 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/group', tags: ['Chat'], summary: '创建群聊',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(z.object({ name: z.string().min(1, '群名不能为空').max(64) })) } },
    responses: { ...commonErrorResponses, ...ok(ChatConversationDTO, '群聊信息') },
  }),
  async (c) => {
    const { name } = c.req.valid('json');
    const conv = await createGroupConversation(name);
    return c.json(okBody(conv), 200);
  },
);

// ─── 群成员列表 ───────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/members', tags: ['Chat'], summary: '获取群成员列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatGroupMemberDTO), '成员列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const members = await listGroupMembers(id);
    return c.json(okBody(members), 200);
  },
);

// ─── 添加群成员 ───────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/members', tags: ['Chat'], summary: '添加群成员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ userId: z.number().int().positive() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('添加成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { userId } = c.req.valid('json');
    await addGroupMember(id, userId);
    return c.json(okBody(null), 200);
  },
);

// ─── 置顶 / 取消置顶 ───────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/pin', tags: ['Chat'], summary: '置顶或取消置顶会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ pin: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('操作成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { pin } = c.req.valid('json');
    await pinConversation(id, pin);
    return c.json(okBody(null), 200);
  },
);

// ─── 标记星标 / 取消星标 ───────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/star', tags: ['Chat'], summary: '标记或取消星标会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ star: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('操作成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { star } = c.req.valid('json');
    await starConversation(id, star);
    return c.json(okBody(null), 200);
  },
);

// ─── 删除/退出会话 ───────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'delete', path: '/conversations/{id}', tags: ['Chat'], summary: '删除（退出）会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('操作成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await removeConversation(id);
    return c.json(okBody(null), 200);
  },
);

// ─── 移除群成员 ───────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'delete', path: '/conversations/{id}/members/{userId}', tags: ['Chat'], summary: '移除群成员（群主专属）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }),
    },
    responses: { ...commonErrorResponses, ...okMsg('移除成功') },
  }),
  async (c) => {
    const { id, userId } = c.req.valid('param');
    await removeGroupMember(id, userId);
    return c.json(okBody(null), 200);
  },
);

// ─── 更新群聊信息（群名/公告）────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/group-info', tags: ['Chat'], summary: '更新群聊名称或公告（群主专属）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: {
        content: jsonContent(z.object({
          name: z.string().min(1).max(64).optional(),
          announcement: z.string().max(500).nullable().optional(),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('更新成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await updateGroupInfo(id, body);
    return c.json(okBody(null), 200);
  },
);

// ─── 转让群主 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/transfer', tags: ['Chat'], summary: '转让群主',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ newOwnerId: z.number().int().positive() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('转让成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { newOwnerId } = c.req.valid('json');
    await transferGroupOwnership(id, newOwnerId);
    return c.json(okBody(null), 200);
  },
);

export default chatRouter;
