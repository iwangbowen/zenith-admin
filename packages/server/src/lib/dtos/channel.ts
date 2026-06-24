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
    isRetracted: z.boolean().optional(),
    retractedAt: z.string().nullable().optional(),
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
    replyType: z.enum(['text', 'card', 'image', 'news']),
    replyContent: z.string(),
    replyExtra: z.object({
      imageUrl: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      cover: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      linkUrl: z.string().nullable().optional(),
    }).nullable(),
    hitCount: z.number().int(),
    status: z.enum(['enabled', 'disabled']),
    sort: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChannelAutoReply');

export const ChannelDashboardDTO = z
  .object({
    overview: z.object({
      businessChannelCount: z.number().int(),
      subscriptionCount: z.number().int(),
      messageCount: z.number().int(),
      todayPushCount: z.number().int(),
      openConversationCount: z.number().int(),
      avgResponseMinutes: z.number().nullable(),
    }),
    trend: z.array(z.object({ date: z.string(), inbound: z.number().int(), outbound: z.number().int() })),
    statusDist: z.object({ open: z.number().int(), processing: z.number().int(), resolved: z.number().int() }),
    readRate: z.number(),
    topReplies: z.array(z.object({
      id: z.number().int(), channelName: z.string(), keyword: z.string().nullable(),
      matchType: z.enum(['subscribe', 'keyword', 'default']), hitCount: z.number().int(),
    })),
    channelRank: z.array(z.object({
      channelId: z.number().int(), channelName: z.string(), messageCount: z.number().int(), subscriberCount: z.number().int(),
    })),
  })
  .openapi('ChannelDashboard');

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
    rating: z.number().int().nullable(),
    ratingComment: z.string().nullable(),
    ratedAt: z.string().nullable(),
  })
  .openapi('ChannelConversation');

export const ChannelSubscriberDTO = z
  .object({
    userId: z.number().int(),
    name: z.string(),
    avatar: z.string().nullable(),
    subscribedAt: z.string().nullable(),
    isMuted: z.boolean(),
  })
  .openapi('ChannelSubscriber');

export const ChannelMessageTemplateDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: z.enum(['text', 'card', 'image', 'news']),
    title: z.string().nullable(),
    content: z.string(),
    extra: ChatMessageExtraDTO.nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ChannelMessageTemplate');

export const ChannelCsPerformanceDTO = z
  .object({
    agentId: z.number().int(),
    agentName: z.string(),
    replyCount: z.number().int(),
    resolvedCount: z.number().int(),
    avgResponseMinutes: z.number().nullable(),
    avgRating: z.number().nullable(),
  })
  .openapi('ChannelCsPerformance');

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
