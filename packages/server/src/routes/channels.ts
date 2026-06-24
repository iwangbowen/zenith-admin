import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg,
  IdParam, PaginationQuery, okBody,
} from '../lib/openapi-schemas';
import {
  createChannelSchema, updateChannelSchema, publishChannelSchema,
  sendChannelMessageSchema, channelReplySchema, saveChannelMenusSchema,
  createChannelAutoReplySchema, updateChannelAutoReplySchema,
  createChannelQuickReplySchema, updateChannelQuickReplySchema,
  assignConversationSchema, setConversationTagsSchema, audienceEstimateSchema,
  createChannelTemplateSchema, updateChannelTemplateSchema, addChannelSubscribersSchema, rateConversationSchema,
} from '@zenith/shared';
import {
  ChannelDTO, ChannelMessageDTO, ChannelAdminDTO,
  ChannelMenuDTO, ChannelAutoReplyDTO, ChannelConversationDTO, ChannelCsChannelDTO, ChannelQuickReplyDTO, ChannelCsAgentDTO, ChannelDashboardDTO,
  ChannelSubscriberDTO, ChannelMessageTemplateDTO, ChannelCsPerformanceDTO,
} from '../lib/openapi-dtos';
import {
  listMyChannels, listChannelMessages, markChannelRead,
  listChannelsAdmin, createChannel, updateChannel, deleteChannel, publishToChannel,
  subscribeChannel, unsubscribeChannel, listDiscoverableChannels,
  listChannelMessageRecords, updateDeferredMessage, deleteDeferredMessage, publishDeferredMessageNow,
  estimateAudience, retractMessage, testSend,
  listChannelSubscribers, addChannelSubscribers, removeChannelSubscriber, exportChannelSubscribers,
} from '../services/channel.service';
import { getChannelDashboard } from '../services/channel-dashboard.service';
import {
  listChannelTemplates, createChannelTemplate, updateChannelTemplate, deleteChannelTemplate,
} from '../services/channel-template.service';
import {
  getChannelMenus, saveChannelMenus,
  listChannelAutoReplies, createChannelAutoReply, updateChannelAutoReply, deleteChannelAutoReply,
  sendUserMessage, replyAsAgent, handleSubscribeAutoReply,
  listCsChannels, listChannelConversations, listConversationMessages,
  listChannelQuickReplies, createChannelQuickReply, updateChannelQuickReply, deleteChannelQuickReply,
  assignConversation, resolveConversation, setConversationTags, listCsAgents,
  rateConversation, getCsPerformance,
} from '../services/channel-cs.service';

const channelsRoute = new OpenAPIHono({ defaultHook: validationHook });

/** 自动回复路由的双路径参数（channelId + replyId） */
const AutoReplyIdParams = z.object({
  channelId: z.coerce.number().int().positive().openapi({ param: { name: 'channelId', in: 'path' }, example: 1 }),
  replyId: z.coerce.number().int().positive().openapi({ param: { name: 'replyId', in: 'path' }, example: 1 }),
});

/** 客服会话路由的双路径参数（channelId=id + 用户 userId） */
const CsConversationParams = z.object({
  id: z.coerce.number().int().positive().openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
  userId: z.coerce.number().int().positive().openapi({ param: { name: 'userId', in: 'path' }, example: 1 }),
});

/** 用户发送消息结果（用户消息 + 命中的自动回复） */
const SendMessageResultDTO = z.object({
  message: ChannelMessageDTO,
  autoReply: ChannelMessageDTO.nullable(),
});

const listMine = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/mine', tags: ['Channels'], summary: '我的频道列表（含未读数）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelDTO), '频道列表') },
  }),
  handler: async (c) => c.json(okBody(await listMyChannels()), 200),
});

const listMessages = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/messages', tags: ['Channels'], summary: '频道消息流（分页）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ChannelMessageDTO, '消息列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listChannelMessages(id, page, pageSize)), 200);
  },
});

const read = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/read', tags: ['Channels'], summary: '标记频道已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已标记已读') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markChannelRead(id);
    return c.json(okBody(null, '已标记已读'), 200);
  },
});

// ─── 管理后台 ────────────────────────────────────────────────────────────────

const adminList = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/admin', tags: ['Channels'], summary: '频道管理列表（含订阅/消息数）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(ChannelAdminDTO, '频道列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, keyword } = c.req.valid('query');
    return c.json(okBody(await listChannelsAdmin(page, pageSize, keyword)), 200);
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Channels'], summary: '新建运营号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:create', audit: { description: '新建频道', module: '消息中心' } })] as const,
    request: { body: { content: jsonContent(createChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelAdminDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createChannel(c.req.valid('json')), '创建成功'), 200),
});

const update = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Channels'], summary: '编辑频道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:update', audit: { description: '编辑频道', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelAdminDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateChannel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Channels'], summary: '删除频道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:delete', audit: { description: '删除频道', module: '消息中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteChannel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const publish = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish', tags: ['Channels'], summary: '向频道群发消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '频道群发', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(publishChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageDTO, '已发布') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await publishToChannel(id, c.req.valid('json')), '已发布'), 200);
  },
});

// ─── 订阅（运营号） ───────────────────────────────────────────────────────────

const discoverable = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/discoverable', tags: ['Channels'], summary: '可订阅的运营号列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { query: z.object({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelDTO), '可订阅频道') },
  }),
  handler: async (c) => c.json(okBody(await listDiscoverableChannels(c.req.valid('query').keyword)), 200),
});

const subscribe = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/subscribe', tags: ['Channels'], summary: '订阅运营号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已订阅') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const firstTime = await subscribeChannel(id);
    if (firstTime) await handleSubscribeAutoReply(id);
    return c.json(okBody(null, '已订阅'), 200);
  },
});

const unsubscribe = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/subscribe', tags: ['Channels'], summary: '退订运营号',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已退订') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await unsubscribeChannel(id);
    return c.json(okBody(null, '已退订'), 200);
  },
});

// ─── 双向消息（用户侧） ───────────────────────────────────────────────────────

const sendMessage = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/send', tags: ['Channels'], summary: '用户向运营号发送消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(sendChannelMessageSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SendMessageResultDTO, '已发送') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { content } = c.req.valid('json');
    return c.json(okBody(await sendUserMessage(id, content), '已发送'), 200);
  },
});

// ─── 公众号底部菜单 ───────────────────────────────────────────────────────────

const listMenus = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/menus', tags: ['Channels'], summary: '频道底部菜单（订阅用户 / 管理共用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelMenuDTO), '菜单树') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getChannelMenus(id)), 200);
  },
});

const saveMenus = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}/menus', tags: ['Channels'], summary: '保存频道底部菜单（整体替换）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:menu:save', audit: { description: '保存频道菜单', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(saveChannelMenusSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelMenuDTO), '保存成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await saveChannelMenus(id, c.req.valid('json')), '保存成功'), 200);
  },
});

// ─── 自动回复 ─────────────────────────────────────────────────────────────────

const listAutoReplies = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/auto-replies', tags: ['Channels'], summary: '频道自动回复列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:reply:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelAutoReplyDTO), '自动回复列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listChannelAutoReplies(id)), 200);
  },
});

const createAutoReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/auto-replies', tags: ['Channels'], summary: '新建自动回复规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:reply:save', audit: { description: '新建自动回复', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createChannelAutoReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelAutoReplyDTO, '创建成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createChannelAutoReply(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateAutoReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{channelId}/auto-replies/{replyId}', tags: ['Channels'], summary: '编辑自动回复规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:reply:save', audit: { description: '编辑自动回复', module: '消息中心' } })] as const,
    request: { params: AutoReplyIdParams, body: { content: jsonContent(updateChannelAutoReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelAutoReplyDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { replyId } = c.req.valid('param');
    return c.json(okBody(await updateChannelAutoReply(replyId, c.req.valid('json')), '更新成功'), 200);
  },
});

const removeAutoReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{channelId}/auto-replies/{replyId}', tags: ['Channels'], summary: '删除自动回复规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:reply:delete', audit: { description: '删除自动回复', module: '消息中心' } })] as const,
    request: { params: AutoReplyIdParams },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { replyId } = c.req.valid('param');
    await deleteChannelAutoReply(replyId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 客服工作台 ───────────────────────────────────────────────────────────────

const csChannels = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/cs/channels', tags: ['Channels'], summary: '客服可服务的运营号列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelCsChannelDTO), '运营号列表') },
  }),
  handler: async (c) => c.json(okBody(await listCsChannels()), 200),
});

const csConversations = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/cs/{id}/conversations', tags: ['Channels'], summary: '客服会话列表（按用户聚合）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs' })] as const,
    request: {
      params: IdParam,
      query: z.object({
        status: z.enum(['open', 'processing', 'resolved']).optional(),
        assignee: z.enum(['mine', 'unassigned', 'all']).optional(),
        keyword: z.string().optional(),
        tag: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelConversationDTO), '会话列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { status, assignee, keyword, tag } = c.req.valid('query');
    return c.json(okBody(await listChannelConversations(id, { status, assignee, keyword, tag })), 200);
  },
});

const csMessages = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/cs/{id}/conversations/{userId}/messages', tags: ['Channels'], summary: '会话双向消息流（分页）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs' })] as const,
    request: { params: CsConversationParams, query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(ChannelMessageDTO, '消息列表') },
  }),
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listConversationMessages(id, userId, page, pageSize)), 200);
  },
});

const csReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/cs/{id}/conversations/{userId}/reply', tags: ['Channels'], summary: '客服回复用户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '客服回复', module: '消息中心' } })] as const,
    request: { params: CsConversationParams, body: { content: jsonContent(channelReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageDTO, '已回复') },
  }),
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const { content } = c.req.valid('json');
    return c.json(okBody(await replyAsAgent(id, userId, content), '已回复'), 200);
  },
});

// ─── 群发消息记录管理（草稿 / 定时 / 已发） ────────────────────────────────────

const adminMessages = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/admin/{id}/messages', tags: ['Channels'], summary: '频道群发消息记录（含草稿/定时）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish' })] as const,
    request: { params: IdParam, query: PaginationQuery.extend({ status: z.enum(['sent', 'draft', 'scheduled']).optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(ChannelMessageDTO, '消息记录') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize, status } = c.req.valid('query');
    return c.json(okBody(await listChannelMessageRecords(id, page, pageSize, status)), 200);
  },
});

const updateDraft = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/admin/messages/{id}', tags: ['Channels'], summary: '编辑草稿/定时消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '编辑草稿消息', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(publishChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageDTO, '已保存') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateDeferredMessage(id, c.req.valid('json')), '已保存'), 200);
  },
});

const deleteDraft = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/admin/messages/{id}', tags: ['Channels'], summary: '删除草稿/取消定时',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '删除草稿消息', module: '消息中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteDeferredMessage(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const publishDraftNow = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/admin/messages/{id}/publish', tags: ['Channels'], summary: '立即发送草稿/定时消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '立即发送草稿', module: '消息中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageDTO, '已发送') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await publishDeferredMessageNow(id), '已发送'), 200);
  },
});

const retract = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/admin/messages/{id}/retract', tags: ['Channels'], summary: '撤回已发送的群发/客服消息',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '撤回消息', module: '消息中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已撤回') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await retractMessage(id);
    return c.json(okBody(null, '已撤回'), 200);
  },
});

const dashboard = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/dashboard', tags: ['Channels'], summary: '频道数据看板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:dashboard' })] as const,
    responses: { ...commonErrorResponses, ...ok(ChannelDashboardDTO, '看板数据') },
  }),
  handler: async (c) => c.json(okBody(await getChannelDashboard()), 200),
});

// ─── 订阅者管理 ───────────────────────────────────────────────────────────────

const subscribers = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/admin/{id}/subscribers', tags: ['Channels'], summary: '频道订阅者列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:list' })] as const,
    request: { params: IdParam, query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(ChannelSubscriberDTO, '订阅者列表') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize, keyword } = c.req.valid('query');
    return c.json(okBody(await listChannelSubscribers(id, page, pageSize, keyword)), 200);
  },
});

const addSubscribers = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/admin/{id}/subscribers', tags: ['Channels'], summary: '添加订阅者',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:update', audit: { description: '添加订阅者', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(addChannelSubscribersSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已添加') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await addChannelSubscribers(id, c.req.valid('json').userIds);
    return c.json(okBody(null, '已添加'), 200);
  },
});

const removeSubscriber = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/admin/{id}/subscribers/{userId}', tags: ['Channels'], summary: '移除订阅者',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:update', audit: { description: '移除订阅者', module: '消息中心' } })] as const,
    request: { params: CsConversationParams },
    responses: { ...commonErrorResponses, ...okMsg('已移除') },
  }),
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    await removeChannelSubscriber(id, userId);
    return c.json(okBody(null, '已移除'), 200);
  },
});

const exportSubscribers = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/admin/{id}/subscribers/export', tags: ['Channels'], summary: '导出订阅者',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:channel:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelSubscriberDTO), '全部订阅者') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await exportChannelSubscribers(id)), 200);
  },
});

// ─── 群发消息模板 ─────────────────────────────────────────────────────────────

const listTemplates = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/templates', tags: ['Channels'], summary: '群发消息模板列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelMessageTemplateDTO), '模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listChannelTemplates()), 200),
});

const createTemplate = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/templates', tags: ['Channels'], summary: '新建群发模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '新建群发模板', module: '消息中心' } })] as const,
    request: { body: { content: jsonContent(createChannelTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageTemplateDTO, '已创建') },
  }),
  handler: async (c) => c.json(okBody(await createChannelTemplate(c.req.valid('json')), '已创建'), 200),
});

const updateTemplate = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/templates/{id}', tags: ['Channels'], summary: '编辑群发模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '编辑群发模板', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateChannelTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageTemplateDTO, '已保存') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateChannelTemplate(id, c.req.valid('json')), '已保存'), 200);
  },
});

const removeTemplate = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/templates/{id}', tags: ['Channels'], summary: '删除群发模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish', audit: { description: '删除群发模板', module: '消息中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteChannelTemplate(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const testSendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/test-send', tags: ['Channels'], summary: '测试发送（仅发给本人）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish' })] as const,
    request: { params: IdParam, body: { content: jsonContent(publishChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelMessageDTO, '已发送测试') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testSend(id, c.req.valid('json')), '已发送测试，请在消息中心查看'), 200);
  },
});

// ─── 会话评价 / 客服绩效 ───────────────────────────────────────────────────────

const rateConv = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/rate', tags: ['Channels'], summary: '用户评价客服会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(rateConversationSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('感谢您的评价') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { rating, comment } = c.req.valid('json');
    await rateConversation(id, rating, comment ?? null);
    return c.json(okBody(null, '感谢您的评价'), 200);
  },
});

const csPerformance = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/cs/performance', tags: ['Channels'], summary: '客服绩效统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelCsPerformanceDTO), '客服绩效') },
  }),
  handler: async (c) => c.json(okBody(await getCsPerformance()), 200),
});

const listQuickReplies = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/cs/quick-replies', tags: ['Channels'], summary: '客服快捷回复列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs' })] as const,
    request: { query: z.object({ channelId: z.coerce.number().int().positive().optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelQuickReplyDTO), '快捷回复列表') },
  }),
  handler: async (c) => c.json(okBody(await listChannelQuickReplies(c.req.valid('query').channelId)), 200),
});

const createQuickReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/cs/quick-replies', tags: ['Channels'], summary: '新建快捷回复',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '新建快捷回复', module: '消息中心' } })] as const,
    request: { body: { content: jsonContent(createChannelQuickReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelQuickReplyDTO, '已创建') },
  }),
  handler: async (c) => c.json(okBody(await createChannelQuickReply(c.req.valid('json')), '已创建'), 200),
});

const updateQuickReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/cs/quick-replies/{id}', tags: ['Channels'], summary: '编辑快捷回复',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '编辑快捷回复', module: '消息中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateChannelQuickReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(ChannelQuickReplyDTO, '已保存') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateChannelQuickReply(id, c.req.valid('json')), '已保存'), 200);
  },
});

const deleteQuickReply = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/cs/quick-replies/{id}', tags: ['Channels'], summary: '删除快捷回复',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '删除快捷回复', module: '消息中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteChannelQuickReply(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

// ─── 客服会话治理（指派/转接 · 解决 · 标签 · 客服列表） ─────────────────────────

const csAgents = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/cs/agents', tags: ['Channels'], summary: '可指派的客服列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(ChannelCsAgentDTO), '客服列表') },
  }),
  handler: async (c) => c.json(okBody(await listCsAgents()), 200),
});

const csAssign = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/cs/{id}/conversations/{userId}/assign', tags: ['Channels'], summary: '指派/转接会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '指派会话', module: '消息中心' } })] as const,
    request: { params: CsConversationParams, body: { content: jsonContent(assignConversationSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已指派') },
  }),
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    await assignConversation(id, userId, c.req.valid('json').assigneeId);
    return c.json(okBody(null, '已指派'), 200);
  },
});

const csResolve = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/cs/{id}/conversations/{userId}/resolve', tags: ['Channels'], summary: '标记会话已解决',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '解决会话', module: '消息中心' } })] as const,
    request: { params: CsConversationParams },
    responses: { ...commonErrorResponses, ...okMsg('已解决') },
  }),
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    await resolveConversation(id, userId);
    return c.json(okBody(null, '已解决'), 200);
  },
});

const csTags = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/cs/{id}/conversations/{userId}/tags', tags: ['Channels'], summary: '设置会话标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:cs', audit: { description: '设置会话标签', module: '消息中心' } })] as const,
    request: { params: CsConversationParams, body: { content: jsonContent(setConversationTagsSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已保存') },
  }),
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    await setConversationTags(id, userId, c.req.valid('json').tags);
    return c.json(okBody(null, '已保存'), 200);
  },
});

// ─── 群发受众预估 ─────────────────────────────────────────────────────────────

const audienceEstimate = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/audience-estimate', tags: ['Channels'], summary: '预估群发受众人数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'channel:message:publish' })] as const,
    request: { body: { content: jsonContent(audienceEstimateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(z.object({ count: z.number().int() }), '预估人数') },
  }),
  handler: async (c) => c.json(okBody({ count: await estimateAudience(c.req.valid('json').audience) }), 200),
});

channelsRoute.openapiRoutes([
  listMine, listMessages, read, adminList, create, update, remove, publish, discoverable, subscribe, unsubscribe,
  sendMessage, listMenus, saveMenus,
  listAutoReplies, createAutoReply, updateAutoReply, removeAutoReply,
] as const);
channelsRoute.openapiRoutes([
  adminMessages, updateDraft, deleteDraft, publishDraftNow, retract, audienceEstimate, dashboard,
  subscribers, addSubscribers, removeSubscriber, exportSubscribers,
  listTemplates, createTemplate, updateTemplate, removeTemplate, testSendRoute, rateConv, csPerformance,
] as const);
channelsRoute.openapiRoutes([
  listQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
  csChannels, csAgents, csConversations, csMessages, csReply, csAssign, csResolve, csTags,
] as const);

export default channelsRoute;
