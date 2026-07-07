import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import {
  ChatMessageDTO, ChatConversationDTO, ChatUserDTO, ChatGroupMemberDTO, ChatLinkPreviewDTO, ChatMessageExtraDTO,
  ChatMessageSearchItemDTO, ChatMessageContextDTO, ChatReactionGroupDTO, ChatReadStateDTO, ChatPresenceDTO, RtcConfigDTO,
  ChatOrgDataDTO, ChatQuickReplyDTO, ChatScheduledMessageDTO,
  ChatCustomEmojiDTO, ChatGroupInviteDTO, ChatInviteInfoDTO, ChatGroupJoinRequestDTO,
} from '../../lib/openapi-dtos';
import { chatCallRecordSchema } from '@zenith/shared';
import {
  listConversations, getOrCreateDirectConversation, listMessages,
  searchConversationMessages, searchGlobalMessages, getMessageContext,
  sendMessage, recallMessage, editMessage, markConversationRead, listChatUsers,
  createGroupConversation, addGroupMember, listGroupMembers,
  removeGroupMember, updateGroupInfo, transferGroupOwnership,
  pinConversation, starConversation, muteConversation, removeConversation,
  getLinkPreview, listPinnedMessages, listFavoriteMessages, listGlobalFavoriteMessages,
  toggleMessageFavorite, toggleMessagePin, listAnnouncementHistory, deleteAnnouncementHistory, forwardMessages, deleteMessagesForUser, toggleReaction, submitVote,
  getConversationReadStates, getPresenceForUsers, getRtcConfig, postCallRecord,
  setMemberRole, muteMember, setMuteAll, getChatOrgData, archiveConversation,
} from '../../services/chat/chat.service';
import {
  listMyQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
} from '../../services/chat/chat-quick-replies.service';
import {
  createScheduledMessage, listMyScheduledMessages, cancelScheduledMessage,
} from '../../services/chat/chat-scheduled.service';
import {
  listMyCustomEmojis, addCustomEmoji, deleteCustomEmoji,
} from '../../services/chat/chat-stickers.service';
import {
  getOrCreateInvite, resetInvite, getInviteInfo, joinByInvite,
  listJoinRequests, handleJoinRequest, setJoinApproval,
} from '../../services/chat/chat-invites.service';

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

// ─── 在线状态（presence）────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/presence', tags: ['Chat'], summary: '批量查询用户在线状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      query: z.object({
        userIds: z.string().optional().openapi({ description: '逗号分隔的用户 ID 列表', example: '1,2,3' }),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatPresenceDTO), '在线状态列表') },
  }),
  async (c) => {
    const { userIds } = c.req.valid('query');
    const ids = (userIds ?? '')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const list = getPresenceForUsers(ids);
    return c.json(okBody(list), 200);
  },
);

// ─── WebRTC 音视频通话 ───────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/rtc/config', tags: ['Chat'], summary: '获取 WebRTC ICE 服务器配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(RtcConfigDTO, 'ICE 配置') },
  }),
  async (c) => {
    return c.json(okBody(getRtcConfig()), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/call-record', tags: ['Chat'], summary: '写入通话记录（系统消息）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(chatCallRecordSchema) } },
    responses: { ...commonErrorResponses, ...okMsg('已记录') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await postCallRecord(id, c.req.valid('json'));
    return c.json(okBody(null), 200);
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

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/favorite-messages', tags: ['Chat'], summary: '我的收藏消息列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ChatMessageDTO, '收藏消息列表') },
  }),
  async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const result = await listGlobalFavoriteMessages(page, pageSize);
    return c.json(okBody(result), 200);
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
    method: 'get', path: '/conversations/{id}/messages', tags: ['Chat'], summary: '获取会话消息（游标分页）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      query: z.object({
        beforeId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(50).default(30),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({ list: z.array(ChatMessageDTO), hasMore: z.boolean() }), '消息列表'),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { beforeId, limit } = c.req.valid('query');
    const result = await listMessages(id, beforeId ?? null, limit);
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
  type: z.enum(['text', 'image', 'file', 'forward', 'vote', 'voice', 'video']).default('text'),
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
    middleware: [authMiddleware, namedRateLimit('chat_send')] as const,
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

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/pinned-messages', tags: ['Chat'], summary: '获取会话置顶消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatMessageDTO), '置顶消息列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const list = await listPinnedMessages(id);
    return c.json(okBody(list), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/favorite-messages', tags: ['Chat'], summary: '获取会话收藏消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ChatMessageDTO, '收藏消息列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    const result = await listFavoriteMessages(id, page, pageSize);
    return c.json(okBody(result), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/messages/{id}/edit', tags: ['Chat'], summary: '编辑消息（24小时内，仅文本）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ content: z.string().min(1).max(4096) })) },
    },
    responses: { ...commonErrorResponses, ...ok(ChatMessageDTO, '编辑后的消息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { content } = c.req.valid('json');
    const msg = await editMessage(id, content);
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

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/messages/{id}/favorite', tags: ['Chat'], summary: '收藏或取消收藏消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ favorite: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...ok(ChatMessageDTO, '消息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { favorite } = c.req.valid('json');
    const msg = await toggleMessageFavorite(id, favorite);
    return c.json(okBody(msg), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/messages/{id}/pin', tags: ['Chat'], summary: '置顶或取消置顶消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ pin: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...ok(ChatMessageDTO, '消息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { pin } = c.req.valid('json');
    const msg = await toggleMessagePin(id, pin);
    return c.json(okBody(msg), 200);
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

// ─── 已读回执：会话成员已读状态 ──────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/read-states', tags: ['Chat'], summary: '获取会话成员已读状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatReadStateDTO), '成员已读状态列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const list = await getConversationReadStates(id);
    return c.json(okBody(list), 200);
  },
);

// ─── 创建群聊 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/group', tags: ['Chat'], summary: '创建群聊',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          name: z.string().min(1, '群名不能为空').max(64),
          /** 初始群成员（可选，不含群主自己） */
          memberIds: z.array(z.number().int().positive()).max(19).optional(),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...ok(ChatConversationDTO, '群聊信息') },
  }),
  async (c) => {
    const { name, memberIds } = c.req.valid('json');
    const conv = await createGroupConversation(name, memberIds ?? []);
    return c.json(okBody(conv), 200);
  },
);

// ─── 归档 / 取消归档 ──────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/archive', tags: ['Chat'], summary: '归档或取消归档会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ archive: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('操作成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { archive } = c.req.valid('json');
    await archiveConversation(id, archive);
    return c.json(okBody(null), 200);
  },
);

// ─── 常用语（个人快捷回复） ───────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/quick-replies', tags: ['Chat'], summary: '我的常用语列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChatQuickReplyDTO), '常用语列表') },
  }),
  async (c) => {
    const list = await listMyQuickReplies();
    return c.json(okBody(list), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/quick-replies', tags: ['Chat'], summary: '新增常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          content: z.string().min(1, '内容不能为空').max(500),
          sort: z.number().int().min(0).max(9999).optional(),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...ok(ChatQuickReplyDTO, '常用语') },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const item = await createQuickReply(body.content, body.sort);
    return c.json(okBody(item), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'put', path: '/quick-replies/{id}', tags: ['Chat'], summary: '更新常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: {
        content: jsonContent(z.object({
          content: z.string().min(1).max(500).optional(),
          sort: z.number().int().min(0).max(9999).optional(),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...ok(ChatQuickReplyDTO, '常用语') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const item = await updateQuickReply(id, body);
    return c.json(okBody(item), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'delete', path: '/quick-replies/{id}', tags: ['Chat'], summary: '删除常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await deleteQuickReply(id);
    return c.json(okBody(null), 200);
  },
);

// ─── 定时消息 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/scheduled-messages', tags: ['Chat'], summary: '创建定时消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: {
        content: jsonContent(z.object({
          content: z.string().min(1, '内容不能为空').max(4096),
          /** 计划发送时间（YYYY-MM-DD HH:mm:ss） */
          scheduledAt: z.string().min(1, '定时时间不能为空'),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...ok(ChatScheduledMessageDTO, '定时消息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const item = await createScheduledMessage(id, { content: body.content, scheduledAt: body.scheduledAt });
    return c.json(okBody(item), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/scheduled-messages', tags: ['Chat'], summary: '我的定时消息列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      query: z.object({ status: z.enum(['pending', 'sent', 'canceled', 'failed']).optional() }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatScheduledMessageDTO), '定时消息列表') },
  }),
  async (c) => {
    const { status } = c.req.valid('query');
    const list = await listMyScheduledMessages(status);
    return c.json(okBody(list), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/scheduled-messages/{id}/cancel', tags: ['Chat'], summary: '取消定时消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已取消') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await cancelScheduledMessage(id);
    return c.json(okBody(null), 200);
  },
);

// ─── 自定义表情 ───────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/custom-emojis', tags: ['Chat'], summary: '我的自定义表情列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChatCustomEmojiDTO), '表情列表') },
  }),
  async (c) => {
    const list = await listMyCustomEmojis();
    return c.json(okBody(list), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/custom-emojis', tags: ['Chat'], summary: '添加自定义表情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          url: z.string().min(1).max(512),
          fileId: z.string().max(64).nullable().optional(),
          name: z.string().max(64).nullable().optional(),
          width: z.number().int().positive().nullable().optional(),
          height: z.number().int().positive().nullable().optional(),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...ok(ChatCustomEmojiDTO, '表情') },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const item = await addCustomEmoji(body);
    return c.json(okBody(item), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'delete', path: '/custom-emojis/{id}', tags: ['Chat'], summary: '删除自定义表情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await deleteCustomEmoji(id);
    return c.json(okBody(null), 200);
  },
);

// ─── 群邀请链接 / 入群审批 ────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/invite', tags: ['Chat'], summary: '获取/生成群邀请链接（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ChatGroupInviteDTO, '邀请信息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const invite = await getOrCreateInvite(id);
    return c.json(okBody(invite), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/conversations/{id}/invite/reset', tags: ['Chat'], summary: '重置群邀请链接（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ChatGroupInviteDTO, '新邀请信息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const invite = await resetInvite(id);
    return c.json(okBody(invite), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/invites/{token}', tags: ['Chat'], summary: '查看邀请链接对应的群信息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ token: z.string().min(8).max(64) }) },
    responses: { ...commonErrorResponses, ...ok(ChatInviteInfoDTO, '群概况') },
  }),
  async (c) => {
    const { token } = c.req.valid('param');
    const info = await getInviteInfo(token);
    return c.json(okBody(info), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/invites/{token}/join', tags: ['Chat'], summary: '通过邀请链接加入群聊',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ token: z.string().min(8).max(64) }),
      body: { content: jsonContent(z.object({ message: z.string().max(255).optional() })) },
    },
    responses: { ...commonErrorResponses, ...ok(z.object({ joined: z.boolean() }), '加入结果') },
  }),
  async (c) => {
    const { token } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const result = await joinByInvite(token, message);
    return c.json(okBody(result), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/join-requests', tags: ['Chat'], summary: '待审批入群申请列表（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatGroupJoinRequestDTO), '申请列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const list = await listJoinRequests(id);
    return c.json(okBody(list), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/join-requests/{id}', tags: ['Chat'], summary: '审批入群申请（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ approve: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('处理成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { approve } = c.req.valid('json');
    await handleJoinRequest(id, approve);
    return c.json(okBody(null), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/join-approval', tags: ['Chat'], summary: '开启/关闭入群审批（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ enabled: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('设置成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    await setJoinApproval(id, enabled);
    return c.json(okBody(null), 200);
  },
);

// ─── 组织架构选人数据 ─────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/org-users', tags: ['Chat'], summary: '获取组织架构选人数据（部门+用户）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(ChatOrgDataDTO, '组织架构数据') },
  }),
  async (c) => {
    const data = await getChatOrgData();
    return c.json(okBody(data), 200);
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

// ─── 免打扰 / 取消免打扰 ───────────────────────────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/mute', tags: ['Chat'], summary: '免打扰或取消免打扰会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ mute: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('操作成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { mute } = c.req.valid('json');
    await muteConversation(id, mute);
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
    method: 'delete', path: '/conversations/{id}/members/{userId}', tags: ['Chat'], summary: '移除群成员（群主/管理员）',
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
    method: 'patch', path: '/conversations/{id}/group-info', tags: ['Chat'], summary: '更新群聊名称或公告（群主/管理员）',
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

// ─── 群管理员 / 禁言 ──────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/members/{userId}/role', tags: ['Chat'], summary: '设置/取消群管理员（群主专属）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }),
      body: { content: jsonContent(z.object({ role: z.enum(['admin', 'member']) })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('设置成功') },
  }),
  async (c) => {
    const { id, userId } = c.req.valid('param');
    const { role } = c.req.valid('json');
    await setMemberRole(id, userId, role);
    return c.json(okBody(null), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/members/{userId}/mute', tags: ['Chat'], summary: '禁言/解除禁言群成员（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() }),
      body: {
        content: jsonContent(z.object({
          mute: z.boolean(),
          /** 禁言时长（分钟），不传 = 永久禁言 */
          durationMinutes: z.number().int().positive().max(43200).optional(),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('操作成功') },
  }),
  async (c) => {
    const { id, userId } = c.req.valid('param');
    const { mute, durationMinutes } = c.req.valid('json');
    await muteMember(id, userId, mute, durationMinutes);
    return c.json(okBody(null), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'patch', path: '/conversations/{id}/mute-all', tags: ['Chat'], summary: '开启/关闭全员禁言（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ muteAll: z.boolean() })) },
    },
    responses: { ...commonErrorResponses, ...okMsg('设置成功') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { muteAll } = c.req.valid('json');
    await setMuteAll(id, muteAll);
    return c.json(okBody(null), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/conversations/{id}/announcement-history', tags: ['Chat'], summary: '获取群公告历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatMessageDTO), '群公告历史') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const list = await listAnnouncementHistory(id);
    return c.json(okBody(list), 200);
  },
);

chatRouter.openapi(
  createRoute({
    method: 'delete', path: '/conversations/{id}/announcement-history/{messageId}', tags: ['Chat'], summary: '删除群公告历史（群主/管理员）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({
        id: z.coerce.number().int().positive(),
        messageId: z.coerce.number().int().positive(),
      }),
    },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  async (c) => {
    const { id, messageId } = c.req.valid('param');
    await deleteAnnouncementHistory(id, messageId);
    return c.json(okBody(null), 200);
  },
);

// ─── 转发消息 ─────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/messages/forward', tags: ['Chat'], summary: '转发消息（逐条或合并）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, namedRateLimit('chat_send')] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          messageIds: z.array(z.number().int().positive()).min(1).max(100),
          targetConversationIds: z.array(z.number().int().positive()).min(1).max(20),
          mode: z.enum(['merge', 'individual']),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('转发成功') },
  }),
  async (c) => {
    const body = c.req.valid('json');
    await forwardMessages(body);
    return c.json(okBody(null), 200);
  },
);

// ─── 删除消息（仅对自己） ─────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/messages/batch-delete', tags: ['Chat'], summary: '批量删除消息（仅对自己隐藏）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          messageIds: z.array(z.number().int().positive()).min(1).max(100),
        })),
      },
    },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  async (c) => {
    const { messageIds } = c.req.valid('json');
    await deleteMessagesForUser(messageIds);
    return c.json(okBody(null, '删除成功'), 200);
  },
);

// ─── 全局消息搜索 ─────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'get', path: '/messages/global-search', tags: ['Chat'], summary: '跨会话全局消息搜索',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      query: z.object({
        keyword: z.string().min(1).max(200),
        types: z.string().optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(50).default(20),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.object({
        list: z.array(ChatMessageSearchItemDTO),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
        conversationNames: z.record(z.string(), z.string()),
      }), '全局搜索结果'),
    },
  }),
  async (c) => {
    const query = c.req.valid('query');
    const result = await searchGlobalMessages({
      keyword: query.keyword,
      types: query.types ? (query.types.split(',').filter(Boolean) as Array<'text' | 'image' | 'file' | 'system'>) : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return c.json(okBody(result), 200);
  },
);

// ─── 消息表情回应 ─────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/messages/{id}/reactions', tags: ['Chat'], summary: '切换消息表情回应（加/取消）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ emoji: z.string().min(1).max(10) })) },
    },
    responses: { ...commonErrorResponses, ...ok(z.array(ChatReactionGroupDTO), '更新后的表情回应列表') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { emoji } = c.req.valid('json');
    const reactions = await toggleReaction(id, emoji);
    return c.json(okBody(reactions), 200);
  },
);

// ─── 投票 ──────────────────────────────────────────────────────────────────────

chatRouter.openapi(
  createRoute({
    method: 'post', path: '/messages/{id}/vote', tags: ['Chat'], summary: '参与投票',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ optionIds: z.array(z.string().min(1).max(36)).min(1).max(10) })) },
    },
    responses: { ...commonErrorResponses, ...ok(ChatMessageDTO, '更新后的投票消息') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { optionIds } = c.req.valid('json');
    const updated = await submitVote(id, optionIds);
    return c.json(okBody(updated), 200);
  },
);

export default chatRouter;
