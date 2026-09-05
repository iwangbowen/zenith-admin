import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { CHANNEL_AUTO_REPLY_MATCH_TYPES, CHANNEL_MESSAGE_TYPES } from '../constants';

// ─── 实体：频道数据看板 ──────────────────────────────────────────────────────

export const channelDashboardOverviewSchema = z.object({
  businessChannelCount: z.int().meta({ description: '运营号数量' }),
  subscriptionCount: z.int().meta({ description: '订阅总数（运营号订阅关系）' }),
  messageCount: z.int().meta({ description: '消息总数（已发送 out）' }),
  todayPushCount: z.int().meta({ description: '今日推送数' }),
  openConversationCount: z.int().meta({ description: '待处理会话数' }),
  avgResponseMinutes: z.number().nullable().meta({ description: '平均首次响应时长（分钟，用户首条 in → 首条人工 out）' }),
}).meta({ id: 'ChannelDashboardOverview' });

export type ChannelDashboardOverview = z.infer<typeof channelDashboardOverviewSchema>;

/** 近 N 天消息量趋势点 */
export const channelDashboardTrendPointSchema = z.object({
  date: z.string(),
  inbound: z.int().meta({ description: '用户来信数' }),
  outbound: z.int().meta({ description: '频道发出数（群发 + 客服回复）' }),
}).meta({ id: 'ChannelDashboardTrendPoint' });

export type ChannelDashboardTrendPoint = z.infer<typeof channelDashboardTrendPointSchema>;

export const channelDashboardStatusDistSchema = z.object({
  open: z.int(),
  processing: z.int(),
  resolved: z.int(),
}).meta({ id: 'ChannelDashboardStatusDist' });

export type ChannelDashboardStatusDist = z.infer<typeof channelDashboardStatusDistSchema>;

/** 热门自动回复（按命中次数） */
export const channelDashboardTopReplySchema = z.object({
  id: z.int(),
  channelName: z.string(),
  keyword: z.string().nullable(),
  matchType: z.enum(CHANNEL_AUTO_REPLY_MATCH_TYPES),
  hitCount: z.int(),
}).meta({ id: 'ChannelDashboardTopReply' });

export type ChannelDashboardTopReply = z.infer<typeof channelDashboardTopReplySchema>;

export const channelDashboardChannelRankSchema = z.object({
  channelId: z.int(),
  channelName: z.string(),
  messageCount: z.int(),
  subscriberCount: z.int(),
}).meta({ id: 'ChannelDashboardChannelRank' });

export type ChannelDashboardChannelRank = z.infer<typeof channelDashboardChannelRankSchema>;

export const channelDashboardSubscriptionTrendPointSchema = z.object({
  date: z.string(),
  count: z.int().meta({ description: '当日新增订阅数' }),
}).meta({ id: 'ChannelDashboardSubscriptionTrendPoint' });

export type ChannelDashboardSubscriptionTrendPoint = z.infer<typeof channelDashboardSubscriptionTrendPointSchema>;

export const channelDashboardMessageTypeDistItemSchema = z.object({
  type: z.enum(CHANNEL_MESSAGE_TYPES),
  count: z.int(),
}).meta({ id: 'ChannelDashboardMessageTypeDistItem' });

export type ChannelDashboardMessageTypeDistItem = z.infer<typeof channelDashboardMessageTypeDistItemSchema>;

export const channelDashboardHourlyPointSchema = z.object({
  hour: z.int(),
  count: z.int(),
}).meta({ id: 'ChannelDashboardHourlyPoint' });

export type ChannelDashboardHourlyPoint = z.infer<typeof channelDashboardHourlyPointSchema>;

export const channelDashboardRatingDistSchema = z.object({
  avgRating: z.number().nullable().meta({ description: '平均评分（保留 1 位小数），无评分时为 null' }),
  dist: z.array(z.object({ rating: z.int(), count: z.int() })),
}).meta({ id: 'ChannelDashboardRatingDist' });

export type ChannelDashboardRatingDist = z.infer<typeof channelDashboardRatingDistSchema>;

export const channelDashboardAutoReplyMatchDistItemSchema = z.object({
  matchType: z.enum(CHANNEL_AUTO_REPLY_MATCH_TYPES),
  count: z.int(),
}).meta({ id: 'ChannelDashboardAutoReplyMatchDistItem' });

export type ChannelDashboardAutoReplyMatchDistItem = z.infer<typeof channelDashboardAutoReplyMatchDistItemSchema>;

export const channelDashboardSchema = z.object({
  overview: channelDashboardOverviewSchema,
  trend: z.array(channelDashboardTrendPointSchema),
  statusDist: channelDashboardStatusDistSchema,
  readRate: z.number().meta({ description: '群发定向消息已读率（0-100）' }),
  topReplies: z.array(channelDashboardTopReplySchema),
  channelRank: z.array(channelDashboardChannelRankSchema),
  subscriptionTrend: z.array(channelDashboardSubscriptionTrendPointSchema).meta({ description: '近 30 天每日新增订阅' }),
  messageTypeDist: z.array(channelDashboardMessageTypeDistItemSchema),
  hourlyDist: z.array(channelDashboardHourlyPointSchema).meta({ description: '按小时消息分布（近 7 天，双向）' }),
  ratingDist: channelDashboardRatingDistSchema,
  autoReplyMatchDist: z.array(channelDashboardAutoReplyMatchDistItemSchema),
}).meta({ id: 'ChannelDashboard' });

export type ChannelDashboard = z.infer<typeof channelDashboardSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const channelDashboardContract = defineContract('/api/channels', {
  dashboard: op.get('/dashboard', { response: channelDashboardSchema, summary: '频道数据看板' }),
}, { tags: ['Channels'] });
