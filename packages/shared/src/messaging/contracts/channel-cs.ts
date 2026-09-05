import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { assignConversationSchema, setConversationTagsSchema } from '../../mp/validation';
import { CHANNEL_CONVERSATION_ASSIGNEE_FILTERS, CHANNEL_CONVERSATION_STATUSES, CHANNEL_MESSAGE_DIRECTIONS } from '../constants';
import { channelReplySchema, createChannelQuickReplySchema, updateChannelQuickReplySchema } from '../validation';
import { channelMessageSchema, channelUserParams } from './channels';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 客服工作台中的一条会话（按用户聚合） */
export const channelConversationSchema = z.object({
  channelId: z.int(),
  userId: z.int(),
  userName: z.string(),
  userAvatar: z.string().nullable(),
  lastMessage: z.string().meta({ description: '最近一条消息内容预览' }),
  lastDirection: z.enum(CHANNEL_MESSAGE_DIRECTIONS),
  lastMessageAt: z.string(),
  unreadCount: z.int().meta({ description: '待客服回复的用户消息数（最近一条客服回复之后的用户消息）' }),
  messageCount: z.int(),
  status: z.enum(CHANNEL_CONVERSATION_STATUSES),
  assigneeId: z.int().nullable().meta({ description: '指派的客服 userId（null=未指派，开放协作）' }),
  assigneeName: z.string().nullable(),
  tags: z.array(z.string()),
  resolvedAt: z.string().nullable(),
  rating: z.int().nullable().meta({ description: '用户评价（1-5 星，null=未评价）' }),
  ratingComment: z.string().nullable(),
  ratedAt: z.string().nullable(),
}).meta({ id: 'ChannelConversation' });

export type ChannelConversation = z.infer<typeof channelConversationSchema>;

/** 客服可服务的运营号 */
export const channelCsChannelSchema = z.object({
  id: z.int(),
  name: z.string(),
  avatar: z.string().nullable(),
}).meta({ id: 'ChannelCsChannel' });

export type ChannelCsChannel = z.infer<typeof channelCsChannelSchema>;

/** 可指派的客服（拥有 channel:cs 权限的用户） */
export const channelCsAgentSchema = z.object({
  id: z.int(),
  name: z.string(),
  avatar: z.string().nullable(),
}).meta({ id: 'ChannelCsAgent' });

export type ChannelCsAgent = z.infer<typeof channelCsAgentSchema>;

/** 客服绩效（按客服聚合） */
export const channelCsPerformanceSchema = z.object({
  agentId: z.int(),
  agentName: z.string(),
  replyCount: z.int().meta({ description: '回复消息数' }),
  resolvedCount: z.int().meta({ description: '标记解决会话数' }),
  avgResponseMinutes: z.number().nullable().meta({ description: '平均首次响应时长（分钟，null=无数据）' }),
  avgRating: z.number().nullable().meta({ description: '平均评分（1-5，null=无评分）' }),
}).meta({ id: 'ChannelCsPerformance' });

export type ChannelCsPerformance = z.infer<typeof channelCsPerformanceSchema>;

/** 客服快捷回复（channelId 为 null 表示全局，所有运营号通用） */
export const channelQuickReplySchema = z.object({
  id: z.int(),
  channelId: z.int().nullable(),
  channelName: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ChannelQuickReply' });

export type ChannelQuickReply = z.infer<typeof channelQuickReplySchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const channelConversationListQuery = z.object({
  status: z.enum(CHANNEL_CONVERSATION_STATUSES).optional(),
  assignee: z.enum(CHANNEL_CONVERSATION_ASSIGNEE_FILTERS).optional(),
  keyword: z.string().optional(),
  tag: z.string().optional(),
});

export const channelQuickReplyListQuery = z.object({
  channelId: z.coerce.number().int().positive().optional().meta({ description: '省略时仅返回全局快捷回复' }),
});

// ─── 契约：客服工作台 ────────────────────────────────────────────────────────

export const channelCsContract = defineContract('/api/channels', {
  csChannels: op.get('/cs/channels', { response: z.array(channelCsChannelSchema), summary: '客服可服务的运营号列表' }),
  csAgents: op.get('/cs/agents', { response: z.array(channelCsAgentSchema), summary: '可指派的客服列表' }),
  csPerformance: op.get('/cs/performance', { response: z.array(channelCsPerformanceSchema), summary: '客服绩效统计' }),
  conversations: op.get('/cs/{id}/conversations', { params: idParam, query: channelConversationListQuery, response: z.array(channelConversationSchema), summary: '客服会话列表（按用户聚合）' }),
  conversationMessages: op.get('/cs/{id}/conversations/{userId}/messages', { params: channelUserParams, query: paginationQuery, response: paginated(channelMessageSchema), summary: '会话双向消息流（分页）' }),
  reply: op.post('/cs/{id}/conversations/{userId}/reply', { params: channelUserParams, body: channelReplySchema, response: channelMessageSchema, summary: '客服回复用户' }),
  assign: op.post('/cs/{id}/conversations/{userId}/assign', { params: channelUserParams, body: assignConversationSchema, summary: '指派 / 转接会话' }),
  resolve: op.post('/cs/{id}/conversations/{userId}/resolve', { params: channelUserParams, summary: '标记会话已解决' }),
  setTags: op.put('/cs/{id}/conversations/{userId}/tags', { params: channelUserParams, body: setConversationTagsSchema, summary: '设置会话标签' }),
  quickReplies: op.get('/cs/quick-replies', { query: channelQuickReplyListQuery, response: z.array(channelQuickReplySchema), summary: '客服快捷回复列表' }),
  createQuickReply: op.post('/cs/quick-replies', { body: createChannelQuickReplySchema, response: channelQuickReplySchema, summary: '新建快捷回复' }),
  updateQuickReply: op.put('/cs/quick-replies/{id}', { params: idParam, body: updateChannelQuickReplySchema, response: channelQuickReplySchema, summary: '编辑快捷回复' }),
  removeQuickReply: op.delete('/cs/quick-replies/{id}', { params: idParam, summary: '删除快捷回复' }),
}, { tags: ['Channels'] });
