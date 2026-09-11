/**
 * CMS 数据看板：站点内容概览（状态分布 / 发布趋势 / 热文 / 栏目分布 / 待办）。
 */
import { and, desc, eq, gte, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { buildWhere } from '../../lib/where-helpers';
import { db } from '../../db';
import { cmsContents, cmsChannels, cmsComments } from '../../db/schema';
import { formatDate, startOfRecentDays, startOfToday } from '../../lib/datetime';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { getAccessibleChannelIds } from './cms-channels.service';

export interface CmsDashboardStats {
  totals: {
    published: number;
    draft: number;
    pending: number;
    offline: number;
    rejected: number;
    recycled: number;
  };
  pendingComments: number;
  todayPublished: number;
  totalViews: number;
  /** 近 14 天发布趋势（含发布数为 0 的日期） */
  publishTrend: { date: string; count: number }[];
  topViewed: { id: number; title: string; viewCount: number; channelName: string | null }[];
  channelDistribution: { channelId: number; channelName: string; count: number }[];
}

const TREND_DAYS = 14;

export async function getCmsDashboardStats(siteId: number): Promise<CmsDashboardStats> {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const accessibleChannelIds = await getAccessibleChannelIds();
  const accessibleChannelCondition = accessibleChannelIds !== null ? inArray(cmsContents.channelId, accessibleChannelIds) : undefined;
  const activeWhere = buildWhere(
    eq(cmsContents.siteId, siteId),
    isNull(cmsContents.deletedAt),
    accessibleChannelCondition,
  );
  const pendingCommentWhere = buildWhere(
    eq(cmsComments.siteId, siteId),
    eq(cmsComments.status, 'pending'),
    accessibleChannelIds !== null
      ? inArray(cmsComments.contentId, db.select({ id: cmsContents.id }).from(cmsContents).where(and(
        eq(cmsContents.siteId, siteId),
        inArray(cmsContents.channelId, accessibleChannelIds),
      )))
      : undefined,
  );
  const todayStart = startOfToday();
  const trendStart = startOfRecentDays(TREND_DAYS);

  const [statusRows, recycled, pendingComments, todayPublished, viewsRow, trendRows, topViewed, channelRows] = await Promise.all([
    db.select({ status: cmsContents.status, count: sql<number>`count(*)::int` })
      .from(cmsContents).where(activeWhere).groupBy(cmsContents.status),
    db.$count(cmsContents, buildWhere(
      eq(cmsContents.siteId, siteId),
      isNotNull(cmsContents.deletedAt),
      accessibleChannelCondition,
    )),
    db.$count(cmsComments, pendingCommentWhere),
    db.$count(cmsContents, and(activeWhere, eq(cmsContents.status, 'published'), gte(cmsContents.publishedAt, todayStart))),
    db.select({ total: sql<number>`coalesce(sum(${cmsContents.viewCount}), 0)::int` })
      .from(cmsContents).where(activeWhere),
    db.select({
      day: sql<string>`to_char(${cmsContents.publishedAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
      .from(cmsContents)
      .where(and(activeWhere, eq(cmsContents.status, 'published'), gte(cmsContents.publishedAt, trendStart)))
      .groupBy(sql`to_char(${cmsContents.publishedAt}, 'YYYY-MM-DD')`),
    db.select({ content: cmsContents, channelName: cmsChannels.name })
      .from(cmsContents)
      .leftJoin(cmsChannels, and(
        eq(cmsContents.channelId, cmsChannels.id),
      ))
      .where(and(activeWhere, eq(cmsContents.status, 'published')))
      .orderBy(desc(cmsContents.viewCount), desc(cmsContents.id))
      .limit(10),
    db.select({
      channelId: cmsContents.channelId,
      channelName: cmsChannels.name,
      count: sql<number>`count(*)::int`,
    })
      .from(cmsContents)
      .innerJoin(cmsChannels, and(
        eq(cmsContents.channelId, cmsChannels.id),
      ))
      .where(activeWhere)
      .groupBy(cmsContents.channelId, cmsChannels.name)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const statusMap = new Map(statusRows.map((r) => [r.status, r.count]));
  const trendMap = new Map(trendRows.map((r) => [r.day, r.count]));
  const publishTrend: { date: string; count: number }[] = [];
  for (let i = 0; i < TREND_DAYS; i++) {
    const day = new Date(trendStart);
    day.setDate(trendStart.getDate() + i);
    const key = formatDate(day);
    publishTrend.push({ date: key, count: trendMap.get(key) ?? 0 });
  }

  return {
    totals: {
      published: statusMap.get('published') ?? 0,
      draft: statusMap.get('draft') ?? 0,
      pending: statusMap.get('pending') ?? 0,
      offline: statusMap.get('offline') ?? 0,
      rejected: statusMap.get('rejected') ?? 0,
      recycled,
    },
    pendingComments,
    todayPublished,
    totalViews: viewsRow[0]?.total ?? 0,
    publishTrend,
    topViewed: topViewed.map((r) => ({
      id: r.content.id,
      title: r.content.title,
      viewCount: r.content.viewCount,
      channelName: r.channelName ?? null,
    })),
    channelDistribution: channelRows.map((r) => ({
      channelId: r.channelId,
      channelName: r.channelName,
      count: r.count,
    })),
  };
}
