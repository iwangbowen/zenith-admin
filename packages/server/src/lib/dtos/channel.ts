/**
 * Channel（站内公众号 / 系统号）相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { ChatMessageExtraDTO } from './chat';

export const ChannelMessageDTO = z
  .object({
    id: z.number().int(),
    channelId: z.number().int(),
    audienceType: z.enum(['broadcast', 'targeted']),
    type: z.enum(['text', 'card', 'image', 'news']),
    title: z.string().nullable(),
    content: z.string(),
    extra: ChatMessageExtraDTO.nullable().optional(),
    publishedById: z.number().int().nullable(),
    direction: z.enum(['out', 'in']),
    senderUserId: z.number().int().nullable(),
    senderUserName: z.string().nullable(),
    isRead: z.boolean(),
    status: z.enum(['sent', 'draft', 'scheduled']),
    scheduledAt: z.string().nullable(),
    readByTarget: z.boolean().nullable().optional(),
    createdAt: z.string(),
  })
  .openapi('ChannelMessage');

export const ChannelDTO = z
  .object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    avatar: z.string().nullable(),
    description: z.string().nullable(),
    type: z.enum(['system', 'business']),
    builtin: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    unreadCount: z.number().int(),
    lastMessage: ChannelMessageDTO.nullable(),
    isMuted: z.boolean(),
    isSubscribed: z.boolean(),
    tenantId: z.number().int().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Channel');

export const ChannelAdminDTO = z
  .object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    avatar: z.string().nullable(),
    description: z.string().nullable(),
    type: z.enum(['system', 'business']),
    builtin: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    subscriberCount: z.number().int(),
    messageCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChannelAdmin');

// ─── 第三期 2D：菜单 / 自动回复 / 会话 ─────────────────────────────────────────

const ChannelMenuNodeDTO = z.object({
  id: z.number().int(),
  channelId: z.number().int(),
  parentId: z.number().int().nullable(),
  name: z.string(),
  type: z.enum(['click', 'view']),
  value: z.string().nullable(),
  sort: z.number().int(),
});

export const ChannelMenuDTO = ChannelMenuNodeDTO
  .extend({
    children: z.array(ChannelMenuNodeDTO).optional(),
  })
  .openapi('ChannelMenu');

export const ChannelAutoReplyDTO = z
  .object({
    id: z.number().int(),
    channelId: z.number().int(),
    matchType: z.enum(['subscribe', 'keyword', 'default']),
    keyword: z.string().nullable(),
    keywordMode: z.enum(['exact', 'contains']),
    replyContent: z.string(),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChannelAutoReply');

export const ChannelConversationDTO = z
  .object({
    channelId: z.number().int(),
    userId: z.number().int(),
    userName: z.string(),
    userAvatar: z.string().nullable(),
    lastMessage: z.string(),
    lastDirection: z.enum(['out', 'in']),
    lastMessageAt: z.string(),
    unreadCount: z.number().int(),
    messageCount: z.number().int(),
    status: z.enum(['open', 'processing', 'resolved']),
    assigneeId: z.number().int().nullable(),
    assigneeName: z.string().nullable(),
    tags: z.array(z.string()),
    resolvedAt: z.string().nullable(),
  })
  .openapi('ChannelConversation');

export const ChannelCsAgentDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    avatar: z.string().nullable(),
  })
  .openapi('ChannelCsAgent');

export const ChannelCsChannelDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    avatar: z.string().nullable(),
  })
  .openapi('ChannelCsChannel');

export const ChannelQuickReplyDTO = z
  .object({
    id: z.number().int(),
    channelId: z.number().int().nullable(),
    channelName: z.string().nullable(),
    title: z.string(),
    content: z.string(),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChannelQuickReply');
