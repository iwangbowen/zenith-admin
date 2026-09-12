import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 渠道推广分析（纯读聚合）：
 * 短链侧点击/UV 按 UTM 维度聚合，选择转化事件时叠加 user_events 的同维度转化数，
 * 形成「渠道 → 点击 → 转化」归因视图。不落新表。
 */
import { and, count, countDistinct, desc, eq, gte, sql } from 'drizzle-orm';
import type { ChannelAnalysisResult, ShortLinkTrendPoint } from '@zenith/shared/short-link';
import { SHORT_LINK_STATS_MAX_DAYS, channelAnalysisContract } from '@zenith/shared/short-link';
import { db } from '../../db';
import { shortLinks, shortLinkClicks, userEvents } from '../../db/schema';
import { formatDate, startOfRecentDays } from '../../lib/datetime';
import { clampDays } from '../../lib/analytics-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';

const ROWS_LIMIT = 20;

const LINK_DIM_COLUMNS = {
  source: shortLinks.utmSource,
  medium: shortLinks.utmMedium,
  campaign: shortLinks.utmCampaign,
} as const;

const EVENT_DIM_COLUMNS = {
  source: userEvents.utmSource,
  medium: userEvents.utmMedium,
  campaign: userEvents.utmCampaign,
} as const;

export async function getChannelAnalysis(q: QueryOutputOf<typeof channelAnalysisContract.analyze>): Promise<ChannelAnalysisResult> {
  const days = clampDays(q.days, 30, SHORT_LINK_STATS_MAX_DAYS);
  const since = startOfRecentDays(days);
  const user = currentUser();

  const dimCol = LINK_DIM_COLUMNS[q.dimension];
  // 兜底值必须内联字面量：绑定参数会让 SELECT 与 GROUP BY 中的同一表达式因占位符编号不同（$1/$4）
  // 被 PG 判定为不同表达式，报「列必须出现在 GROUP BY 中」
  const dimExpr = sql<string>`coalesce(nullif(${dimCol}, ''), '未设置')`;
  const clicksWhere = buildWhere(
    and(eq(shortLinkClicks.isBot, false), gte(shortLinkClicks.clickedAt, since)),
    tenantCondition(shortLinks, user),
  );
  const dateExpr = sql<string>`to_char(${shortLinkClicks.clickedAt}, 'YYYY-MM-DD')`;

  const [dimRows, trendRows, totalsRow] = await Promise.all([
    db
      .select({ name: dimExpr, clicks: count(), uv: countDistinct(shortLinkClicks.visitorId) })
      .from(shortLinkClicks)
      .innerJoin(shortLinks, eq(shortLinkClicks.linkId, shortLinks.id))
      .where(clicksWhere)
      .groupBy(dimExpr)
      .orderBy(desc(count()))
      .limit(ROWS_LIMIT),
    db
      .select({ date: dateExpr, clicks: count(), uv: countDistinct(shortLinkClicks.visitorId) })
      .from(shortLinkClicks)
      .innerJoin(shortLinks, eq(shortLinkClicks.linkId, shortLinks.id))
      .where(clicksWhere)
      .groupBy(dateExpr),
    db
      .select({
        clicks: count(),
        uv: countDistinct(shortLinkClicks.visitorId),
        links: countDistinct(shortLinkClicks.linkId),
      })
      .from(shortLinkClicks)
      .innerJoin(shortLinks, eq(shortLinkClicks.linkId, shortLinks.id))
      .where(clicksWhere),
  ]);

  // 转化侧：user_events 同维度聚合（事件由 UTM 参数归因到渠道）
  let convByName: Map<string, number> | null = null;
  let totalConversions: number | null = null;
  const convEvent = q.convEvent?.trim();
  if (convEvent) {
    const evDimCol = EVENT_DIM_COLUMNS[q.dimension];
    const evDimExpr = sql<string>`coalesce(nullif(${evDimCol}, ''), '未设置')`;
    const convRows = await db
      .select({ name: evDimExpr, conversions: count() })
      .from(userEvents)
      .where(buildWhere(
        and(eq(userEvents.eventName, convEvent), gte(userEvents.createdAt, since)),
        tenantCondition(userEvents, user),
      ))
      .groupBy(evDimExpr);
    convByName = new Map(convRows.map((r) => [r.name, Number(r.conversions)]));
    totalConversions = convRows.reduce((s, r) => s + Number(r.conversions), 0);
  }

  const rows = dimRows.map((r) => {
    const clicks = Number(r.clicks);
    const conversions = convByName ? (convByName.get(r.name) ?? 0) : null;
    return {
      name: r.name,
      clicks,
      uv: Number(r.uv),
      conversions,
      convRate: conversions !== null && clicks > 0 ? Number((conversions / clicks).toFixed(4)) : null,
    };
  });

  // 趋势按窗口补零
  const trendMap = new Map(trendRows.map((r) => [r.date, { pv: Number(r.clicks), uv: Number(r.uv) }]));
  const trend: ShortLinkTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = formatDate(d);
    const point = trendMap.get(key);
    trend.push({ date: key, pv: point?.pv ?? 0, uv: point?.uv ?? 0 });
  }

  return {
    totals: {
      clicks: Number(totalsRow[0]?.clicks ?? 0),
      uv: Number(totalsRow[0]?.uv ?? 0),
      links: Number(totalsRow[0]?.links ?? 0),
      conversions: totalConversions,
    },
    trend,
    rows,
  };
}
