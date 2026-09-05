import * as z from 'zod';
import { chatMessageExtraSchema } from '../../chat/contracts/chat-messages';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { addChannelSubscribersSchema, rateConversationSchema, saveChannelMenusSchema } from '../../mp/validation';
import {
  CHANNEL_AUDIENCE_TYPES,
  CHANNEL_AUTO_REPLY_KEYWORD_MODES,
  CHANNEL_AUTO_REPLY_MATCH_TYPES,
  CHANNEL_MENU_TYPES,
  CHANNEL_MESSAGE_DIRECTIONS,
  CHANNEL_MESSAGE_STATUSES,
  CHANNEL_MESSAGE_TYPES,
  CHANNEL_TYPES,
} from '../constants';
import {
  createChannelAutoReplySchema,
  createChannelSchema,
  sendChannelMessageSchema,
  updateChannelAutoReplySchema,
  updateChannelSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 频道内一条消息（卡片复用 ChatMessageExtra.card / 身份用 extra.bot） */
export const channelMessageSchema = z.object({
  id: z.int(),
  channelId: z.int(),
  audienceType: z.enum(CHANNEL_AUDIENCE_TYPES),
  type: z.enum(CHANNEL_MESSAGE_TYPES),
  title: z.string().nullable(),
  content: z.string(),
  extra: chatMessageExtraSchema.nullable(),
  publishedById: z.int().nullable(),
  direction: z.enum(CHANNEL_MESSAGE_DIRECTIONS).meta({ description: 'out=频道→用户（群发 / 客服 / 自动回复）；in=用户→频道' }),
  senderUserId: z.int().nullable().meta({ description: 'in 消息=发送用户；out 客服回复=客服用户；自动回复 / 群发为 null' }),
  senderUserName: z.string().nullable(),
  isRead: z.boolean().meta({ description: '当前用户视角是否已读' }),
  status: z.enum(CHANNEL_MESSAGE_STATUSES),
  scheduledAt: z.string().nullable().meta({ description: '定时发送时间（status=scheduled 时有值）' }),
  readByTarget: z.boolean().nullable().optional().meta({ description: '客服会话视角：该 out 定向消息是否已被目标用户读取（非定向为 null）' }),
  isRetracted: z.boolean().optional(),
  retractedAt: z.string().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'ChannelMessage' });

export type ChannelMessage = z.infer<typeof channelMessageSchema>;

/** 公众号 / 系统号（在聊天会话列表中以只读频道形式呈现） */
export const channelSchema = z.object({
  id: z.int(),
  code: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  description: z.string().nullable(),
  type: z.enum(CHANNEL_TYPES),
  builtin: z.boolean(),
  status: entityStatusSchema,
  unreadCount: z.int().meta({ description: '当前用户未读数' }),
  lastMessage: channelMessageSchema.nullable(),
  isMuted: z.boolean(),
  isSubscribed: z.boolean(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Channel' });

export type Channel = z.infer<typeof channelSchema>;

/** 频道管理后台视图（含订阅数 / 消息数） */
export const channelAdminSchema = z.object({
  id: z.int(),
  code: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  description: z.string().nullable(),
  type: z.enum(CHANNEL_TYPES),
  builtin: z.boolean(),
  status: entityStatusSchema,
  subscriberCount: z.int(),
  messageCount: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ChannelAdmin' });

export type ChannelAdmin = z.infer<typeof channelAdminSchema>;

/** 用户向运营号发送消息的结果（用户消息 + 命中的自动回复） */
export const channelSendMessageResultSchema = z.object({
  message: channelMessageSchema,
  autoReply: channelMessageSchema.nullable(),
}).meta({ id: 'ChannelSendMessageResult' });

export type ChannelSendMessageResult = z.infer<typeof channelSendMessageResultSchema>;

const channelMenuNodeSchema = z.object({
  id: z.int(),
  channelId: z.int(),
  parentId: z.int().nullable(),
  name: z.string(),
  type: z.enum(CHANNEL_MENU_TYPES),
  value: z.string().nullable().meta({ description: 'click=关键词文案；view=跳转 URL；含子菜单的一级菜单可为空' }),
  sort: z.int(),
});

/** 公众号底部菜单节点（最多 3 个一级，每个一级下最多 5 个二级） */
export const channelMenuSchema = channelMenuNodeSchema.extend({
  children: z.array(channelMenuNodeSchema).optional(),
}).meta({ id: 'ChannelMenu' });

export type ChannelMenu = z.infer<typeof channelMenuSchema>;

/** 富内容自动回复的扩展数据（replyType=image/news 时使用） */
export const channelRichReplyExtraSchema = z.object({
  imageUrl: z.string().nullable().optional().meta({ description: '图片消息：图片 URL' }),
  title: z.string().nullable().optional(),
  cover: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  bodyHtml: z.string().nullable().optional().meta({ description: '图文消息：富文本正文（服务端净化后存储）' }),
}).meta({ id: 'ChannelRichReplyExtra' });

export type ChannelRichReplyExtra = z.infer<typeof channelRichReplyExtraSchema>;

/** 频道自动回复规则 */
export const channelAutoReplySchema = z.object({
  id: z.int(),
  channelId: z.int(),
  matchType: z.enum(CHANNEL_AUTO_REPLY_MATCH_TYPES),
  keyword: z.string().nullable().meta({ description: '关键词（matchType=keyword 时必填）' }),
  keywordMode: z.enum(CHANNEL_AUTO_REPLY_KEYWORD_MODES),
  replyType: z.enum(CHANNEL_MESSAGE_TYPES),
  replyContent: z.string(),
  replyExtra: channelRichReplyExtraSchema.nullable(),
  hitCount: z.int(),
  status: entityStatusSchema,
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ChannelAutoReply' });

export type ChannelAutoReply = z.infer<typeof channelAutoReplySchema>;

/** 频道订阅者（订阅者管理） */
export const channelSubscriberSchema = z.object({
  userId: z.int(),
  name: z.string(),
  avatar: z.string().nullable(),
  subscribedAt: z.string().nullable().meta({ description: '订阅时间（系统号全员为 null）' }),
  isMuted: z.boolean(),
}).meta({ id: 'ChannelSubscriber' });

export type ChannelSubscriber = z.infer<typeof channelSubscriberSchema>;

// ─── 路径 / 查询参数 ─────────────────────────────────────────────────────────

/** `{channelId}` 频道 + `{replyId}` 自动回复规则 */
export const channelAutoReplyParams = z.object({
  channelId: z.coerce.number().int().positive().meta({ description: '频道 ID', example: 1 }),
  replyId: z.coerce.number().int().positive().meta({ description: '自动回复规则 ID', example: 1 }),
});

/** `{id}` 频道 + `{userId}` 用户 */
export const channelUserParams = idParam.extend({
  userId: z.coerce.number().int().positive().meta({ description: '用户 ID', example: 1 }),
});

export const channelKeywordQuery = z.object({
  keyword: z.string().optional(),
});

export const channelAdminListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 编码模糊匹配' }),
});

export const channelSubscriberListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按昵称 / 用户名模糊匹配' }),
});

// ─── 契约：频道本体 / 订阅 / 菜单 / 自动回复 / 订阅者 ────────────────────────

export const channelContract = defineContract('/api/channels', {
  // 用户侧
  mine: op.get('/mine', { response: z.array(channelSchema), summary: '我的频道列表（含未读数）' }),
  messages: op.get('/{id}/messages', { params: idParam, query: paginationQuery, response: paginated(channelMessageSchema), summary: '频道消息流（分页）' }),
  markRead: op.post('/{id}/read', { params: idParam, summary: '标记频道已读' }),
  discoverable: op.get('/discoverable', { query: channelKeywordQuery, response: z.array(channelSchema), summary: '可订阅的运营号列表' }),
  subscribe: op.post('/{id}/subscribe', { params: idParam, summary: '订阅运营号' }),
  unsubscribe: op.delete('/{id}/subscribe', { params: idParam, summary: '退订运营号' }),
  send: op.post('/{id}/send', { params: idParam, body: sendChannelMessageSchema, response: channelSendMessageResultSchema, summary: '用户向运营号发送消息' }),
  rate: op.post('/{id}/rate', { params: idParam, body: rateConversationSchema, summary: '用户评价客服会话' }),
  menus: op.get('/{id}/menus', { params: idParam, response: z.array(channelMenuSchema), summary: '频道底部菜单（订阅用户 / 管理共用）' }),

  // 管理后台
  list: op.get('/admin', { query: channelAdminListQuery, response: paginated(channelAdminSchema), summary: '频道管理列表（含订阅 / 消息数）' }),
  create: op.post('/', { body: createChannelSchema, response: channelAdminSchema, summary: '新建运营号' }),
  update: op.put('/{id}', { params: idParam, body: updateChannelSchema, response: channelAdminSchema, summary: '编辑频道' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除频道' }),
  saveMenus: op.put('/{id}/menus', { params: idParam, body: saveChannelMenusSchema, response: z.array(channelMenuSchema), summary: '保存频道底部菜单（整体替换）' }),
  autoReplies: op.get('/{id}/auto-replies', { params: idParam, response: z.array(channelAutoReplySchema), summary: '频道自动回复列表' }),
  createAutoReply: op.post('/{id}/auto-replies', { params: idParam, body: createChannelAutoReplySchema, response: channelAutoReplySchema, summary: '新建自动回复规则' }),
  updateAutoReply: op.put('/{channelId}/auto-replies/{replyId}', { params: channelAutoReplyParams, body: updateChannelAutoReplySchema, response: channelAutoReplySchema, summary: '编辑自动回复规则' }),
  removeAutoReply: op.delete('/{channelId}/auto-replies/{replyId}', { params: channelAutoReplyParams, summary: '删除自动回复规则' }),
  subscribers: op.get('/admin/{id}/subscribers', { params: idParam, query: channelSubscriberListQuery, response: paginated(channelSubscriberSchema), summary: '频道订阅者列表' }),
  addSubscribers: op.post('/admin/{id}/subscribers', { params: idParam, body: addChannelSubscribersSchema, summary: '添加订阅者' }),
  removeSubscriber: op.delete('/admin/{id}/subscribers/{userId}', { params: channelUserParams, summary: '移除订阅者' }),
}, { tags: ['Channels'] });
