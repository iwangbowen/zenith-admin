/**
 * 频道数据看板（I）聚合服务
 *
 * 概览指标 + 近 7 天消息趋势 + 会话状态分布 + 群发已读率 + 热门自动回复 + 运营号排行
 * + 订阅增长 + 消息类型分布 + 小时分布 + 会话评分 + 自动回复命中类型占比。
 * 纯只读聚合，所有独立查询用 Promise.all 并行。
 */
import { and, eq, desc, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  channels, channelMessages, channelSubscriptions, channelConversations,
  channelAutoReplies, channelMessageTargets,
} from '../../db/schema';
import type {
  ChannelDashboard, ChannelDashboardTrendPoint, ChannelDashboardStatusDist, ChannelDashboardTopReply, ChannelDashboardChannelRank,
  ChannelDashboardSubscriptionTrendPoint, ChannelDashboardMessageTypeDistItem, ChannelDashboardHourlyPoint,
  ChannelDashboardRatingDist, ChannelDashboardAutoReplyMatchDistItem,
} from '@zenith/shared/messaging';
import { formatDate, startOfToday } from '../../lib/datetime';

function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}

/** 近 7 天消息趋势（含今天，共 7 个点） */
async function buildTrend(): Promise<ChannelDashboardTrendPoint[]> {
  const since = daysAgo(6);
  const rows = await db.select({ direction: channelMessages.direction, createdAt: channelMessages.createdAt })
    .from(channelMessages)
    .where(and(gte(channelMessages.createdAt, since), eq(channelMessages.status, 'sent'), isNull(channelMessages.retractedAt)));

  const buckets = new Map<string, { inbound: number; outbound: number }>();
  for (let i = 6; i >= 0; i--) {
    buckets.set(formatDate(daysAgo(i)), { inbound: 0, outbound: 0 });
  }
  for (const r of rows) {
    const key = formatDate(r.createdAt);
    const b = buckets.get(key);
    if (!b) continue;
    if (r.direction === 'in') b.inbound += 1;
    else b.outbound += 1;
  }
  return [...buckets.entries()].map(([date, v]) => ({ date, inbound: v.inbound, outbound: v.outbound }));
}

/** 会话状态分布 */
async function buildStatusDist(): Promise<ChannelDashboardStatusDist> {
  const rows = await db.select({ status: channelConversations.status, count: sql<number>`count(*)::int` })
    .from(channelConversations)
    .groupBy(channelConversations.status);
  const dist: ChannelDashboardStatusDist = { open: 0, processing: 0, resolved: 0 };
  for (const r of rows) dist[r.status] = Number(r.count);
  return dist;
}

/** 平均首次响应时长（分钟）：近 30 天，用户首条 in → 首条人工 out */
async function buildAvgResponseMinutes(): Promise<number | null> {
  const since = daysAgo(30);
  const [ins, outs] = await Promise.all([
    db.select({
      channelId: channelMessages.channelId,
      userId: channelMessages.senderUserId,
      firstAt: sql<string>`min(${channelMessages.createdAt})`,
    }).from(channelMessages)
      .where(and(eq(channelMessages.direction, 'in'), gte(channelMessages.createdAt, since), isNotNull(channelMessages.senderUserId)))
      .groupBy(channelMessages.channelId, channelMessages.senderUserId),
    db.select({
      channelId: channelMessages.channelId,
      userId: channelMessageTargets.userId,
      firstAt: sql<string>`min(${channelMessages.createdAt})`,
    }).from(channelMessages)
      .innerJoin(channelMessageTargets, eq(channelMessageTargets.messageId, channelMessages.id))
      .where(and(eq(channelMessages.direction, 'out'), isNotNull(channelMessages.senderUserId), gte(channelMessages.createdAt, since)))
      .groupBy(channelMessages.channelId, channelMessageTargets.userId),
  ]);

  const outMap = new Map<string, number>();
  for (const o of outs) {
    if (o.userId == null) continue;
    outMap.set(`${o.channelId}:${o.userId}`, new Date(o.firstAt).getTime());
  }
  let totalMs = 0;
  let n = 0;
  for (const i of ins) {
    if (i.userId == null) continue;
    const outAt = outMap.get(`${i.channelId}:${i.userId}`);
    if (outAt == null) continue;
    const diff = outAt - new Date(i.firstAt).getTime();
    if (diff <= 0) continue;
    totalMs += diff;
    n += 1;
  }
  if (n === 0) return null;
  return Math.round(totalMs / n / 60000);
}

/** 热门自动回复 top 5（按命中次数） */
async function buildTopReplies(): Promise<ChannelDashboardTopReply[]> {
  const rows = await db.select({
    id: channelAutoReplies.id,
    channelName: channels.name,
    keyword: channelAutoReplies.keyword,
    matchType: channelAutoReplies.matchType,
    hitCount: channelAutoReplies.hitCount,
  }).from(channelAutoReplies)
    .innerJoin(channels, eq(channels.id, channelAutoReplies.channelId))
    .where(sql`${channelAutoReplies.hitCount} > 0`)
    .orderBy(desc(channelAutoReplies.hitCount))
    .limit(5);
  return rows.map((r) => ({
    id: r.id, channelName: r.channelName, keyword: r.keyword, matchType: r.matchType, hitCount: r.hitCount,
  }));
}

/** 运营号消息排行 top 5 */
async function buildChannelRank(): Promise<ChannelDashboardChannelRank[]> {
  const bizChannels = await db.select({ id: channels.id, name: channels.name })
    .from(channels).where(eq(channels.type, 'business'));
  if (bizChannels.length === 0) return [];

  // 两条 GROUP BY 聚合一次取齐全部频道计数（此前每频道各发 2 条 COUNT，查询数随频道数线性增长）
  const [msgRows, subRows] = await Promise.all([
    db.select({ channelId: channelMessages.channelId, count: sql<number>`count(*)::int` })
      .from(channelMessages)
      .where(and(
        eq(channelMessages.direction, 'out'),
        eq(channelMessages.status, 'sent'),
        isNull(channelMessages.retractedAt),
      ))
      .groupBy(channelMessages.channelId),
    db.select({ channelId: channelSubscriptions.channelId, count: sql<number>`count(*)::int` })
      .from(channelSubscriptions)
      .groupBy(channelSubscriptions.channelId),
  ]);
  const msgCounts = new Map(msgRows.map((r) => [r.channelId, Number(r.count)]));
  const subCounts = new Map(subRows.map((r) => [r.channelId, Number(r.count)]));

  return bizChannels
    .map((ch) => ({
      channelId: ch.id,
      channelName: ch.name,
      messageCount: msgCounts.get(ch.id) ?? 0,
      subscriberCount: subCounts.get(ch.id) ?? 0,
    }))
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 5);
}

/** 近 30 天每日新增订阅（含今天，共 30 个点） */
async function buildSubscriptionTrend(): Promise<ChannelDashboardSubscriptionTrendPoint[]> {
  const since = daysAgo(29);
  const rows = await db.select({
    date: sql<string>`to_char(date(${channelSubscriptions.subscribedAt}), 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
  }).from(channelSubscriptions)
    .where(gte(channelSubscriptions.subscribedAt, since))
    .groupBy(sql`date(${channelSubscriptions.subscribedAt})`);

  const counts = new Map(rows.map((r) => [r.date, Number(r.count)]));
  const points: ChannelDashboardSubscriptionTrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = formatDate(daysAgo(i));
    points.push({ date, count: counts.get(date) ?? 0 });
  }
  return points;
}

/** 消息类型分布（已发送 out，未撤回） */
async function buildMessageTypeDist(): Promise<ChannelDashboardMessageTypeDistItem[]> {
  const rows = await db.select({ type: channelMessages.type, count: sql<number>`count(*)::int` })
    .from(channelMessages)
    .where(and(eq(channelMessages.direction, 'out'), eq(channelMessages.status, 'sent'), isNull(channelMessages.retractedAt)))
    .groupBy(channelMessages.type)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ type: r.type, count: Number(r.count) }));
}

/** 按小时消息分布（近 7 天双向，0-23 全量补齐） */
async function buildHourlyDist(): Promise<ChannelDashboardHourlyPoint[]> {
  const since = daysAgo(6);
  const rows = await db.select({
    hour: sql<number>`extract(hour from ${channelMessages.createdAt})::int`,
    count: sql<number>`count(*)::int`,
  }).from(channelMessages)
    .where(and(gte(channelMessages.createdAt, since), eq(channelMessages.status, 'sent'), isNull(channelMessages.retractedAt)))
    .groupBy(sql`extract(hour from ${channelMessages.createdAt})`);

  const counts = new Map(rows.map((r) => [Number(r.hour), Number(r.count)]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: counts.get(hour) ?? 0 }));
}

/** 会话评分分布（1-5 星全量补齐）与平均分 */
async function buildRatingDist(): Promise<ChannelDashboardRatingDist> {
  const rows = await db.select({ rating: channelConversations.rating, count: sql<number>`count(*)::int` })
    .from(channelConversations)
    .where(isNotNull(channelConversations.rating))
    .groupBy(channelConversations.rating);

  const counts = new Map(rows.map((r) => [Number(r.rating), Number(r.count)]));
  const dist = Array.from({ length: 5 }, (_, i) => ({ rating: i + 1, count: counts.get(i + 1) ?? 0 }));
  const total = dist.reduce((sum, d) => sum + d.count, 0);
  const avgRating = total === 0
    ? null
    : Math.round((dist.reduce((sum, d) => sum + d.rating * d.count, 0) / total) * 10) / 10;
  return { avgRating, dist };
}

/** 自动回复命中类型占比（按累计命中次数） */
async function buildAutoReplyMatchDist(): Promise<ChannelDashboardAutoReplyMatchDistItem[]> {
  const rows = await db.select({
    matchType: channelAutoReplies.matchType,
    count: sql<number>`sum(${channelAutoReplies.hitCount})::int`,
  }).from(channelAutoReplies)
    .where(sql`${channelAutoReplies.hitCount} > 0`)
    .groupBy(channelAutoReplies.matchType);
  return rows.map((r) => ({ matchType: r.matchType, count: Number(r.count) }));
}

export async function getChannelDashboard(): Promise<ChannelDashboard> {
  const [
    businessChannelCount, subscriptionCount, messageCount, todayPushCount, openConversationCount,
    targetsTotal, targetsRead,
    avgResponseMinutes, trend, statusDist, topReplies, channelRank,
    subscriptionTrend, messageTypeDist, hourlyDist, ratingDist, autoReplyMatchDist,
  ] = await Promise.all([
    db.$count(channels, eq(channels.type, 'business')),
    db.$count(channelSubscriptions),
    db.$count(channelMessages, and(eq(channelMessages.direction, 'out'), eq(channelMessages.status, 'sent'), isNull(channelMessages.retractedAt))),
    db.$count(channelMessages, and(eq(channelMessages.direction, 'out'), eq(channelMessages.status, 'sent'), isNull(channelMessages.retractedAt), gte(channelMessages.createdAt, startOfToday()))),
    db.$count(channelConversations, eq(channelConversations.status, 'open')),
    db.$count(channelMessageTargets),
    db.$count(channelMessageTargets, isNotNull(channelMessageTargets.readAt)),
    buildAvgResponseMinutes(),
    buildTrend(),
    buildStatusDist(),
    buildTopReplies(),
    buildChannelRank(),
    buildSubscriptionTrend(),
    buildMessageTypeDist(),
    buildHourlyDist(),
    buildRatingDist(),
    buildAutoReplyMatchDist(),
  ]);

  const readRate = targetsTotal > 0 ? Math.round((targetsRead / targetsTotal) * 100) : 0;

  return {
    overview: {
      businessChannelCount,
      subscriptionCount,
      messageCount,
      todayPushCount,
      openConversationCount,
      avgResponseMinutes,
    },
    trend,
    statusDist,
    readRate,
    topReplies,
    channelRank,
    subscriptionTrend,
    messageTypeDist,
    hourlyDist,
    ratingDist,
    autoReplyMatchDist,
  };
}
