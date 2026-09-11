/**
 * 短链统计读路径：short_link_daily_stats（物化日聚合）与点击明细按日合并取 max——
 * 聚合已覆盖的历史日以聚合为准，未及聚合的新数据由明细兜底；
 * 明细被保留策略裁剪后，长周期趋势与累计值仍由聚合表支撑。
 * 设备/地域/来源等维度分布来自明细，覆盖范围受明细保留窗口限制。
 */
import { and, count, countDistinct, desc, eq, gte, sql } from 'drizzle-orm';
import type { ShortLinkStats, ShortLinkTrendPoint } from '@zenith/shared/short-link';
import { SHORT_LINK_STATS_DEFAULT_DAYS, SHORT_LINK_STATS_MAX_DAYS, SHORT_LINK_STATS_TOP_LIMIT } from '@zenith/shared/short-link';
import { db } from '../../db';
import { shortLinkClicks, shortLinkDailyStats } from '../../db/schema';
import { formatDate, startOfRecentDays, startOfToday } from '../../lib/datetime';
import { clampDays } from '../../lib/analytics-helpers';
import { ensureShortLinkExists } from './short-link.service';

/** 维度分布查询（非爬虫口径，窗口内 Top N；数据源为点击明细） */
async function dimensionBreakdown(linkId: number, since: Date, column: 'deviceType' | 'os' | 'browser' | 'province') {
  const col = shortLinkClicks[column];
  const rows = await db
    .select({ name: col, count: count() })
    .from(shortLinkClicks)
    .where(and(eq(shortLinkClicks.linkId, linkId), eq(shortLinkClicks.isBot, false), gte(shortLinkClicks.clickedAt, since)))
    .groupBy(col)
    .orderBy(desc(count()))
    .limit(SHORT_LINK_STATS_TOP_LIMIT);
  return rows.map((r) => ({ name: r.name ?? '未知', count: Number(r.count) }));
}

/** 来源分布：按 referer 主机名聚合，空值归为「直接访问」 */
async function refererBreakdown(linkId: number, since: Date) {
  const host = sql<string>`coalesce(nullif(split_part(split_part(${shortLinkClicks.referer}, '://', 2), '/', 1), ''), '直接访问')`;
  const rows = await db
    .select({ name: host, count: count() })
    .from(shortLinkClicks)
    .where(and(eq(shortLinkClicks.linkId, linkId), eq(shortLinkClicks.isBot, false), gte(shortLinkClicks.clickedAt, since)))
    .groupBy(host)
    .orderBy(desc(count()))
    .limit(SHORT_LINK_STATS_TOP_LIMIT);
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

interface DayAgg { pv: number; uv: number }

/** 管理端入口：行级访问校验（租户边界）后计算 */
export async function getShortLinkStats(id: number, days?: number): Promise<ShortLinkStats> {
  await ensureShortLinkExists(id);
  return computeShortLinkStats(id, days);
}

/**
 * 统计核心计算（无访问校验）：管理端与开放 API 共用，
 * 调用方自行保证 id 已通过各自的访问边界检查。
 */
export async function computeShortLinkStats(id: number, days?: number): Promise<ShortLinkStats> {
  const windowDays = clampDays(days, SHORT_LINK_STATS_DEFAULT_DAYS, SHORT_LINK_STATS_MAX_DAYS);
  const since = startOfRecentDays(windowDays);
  const notBot = and(eq(shortLinkClicks.linkId, id), eq(shortLinkClicks.isBot, false));

  const dateExpr = sql<string>`to_char(${shortLinkClicks.clickedAt}, 'YYYY-MM-DD')`;

  const [clickDays, rolledDays, devices, browsers, regions, referers] = await Promise.all([
    // 明细按日聚合（含今天；保留策略裁剪后仅剩近期天）
    db
      .select({ date: dateExpr, pv: count(), uv: countDistinct(shortLinkClicks.visitorId) })
      .from(shortLinkClicks)
      .where(notBot)
      .groupBy(dateExpr),
    // 物化日聚合（今天之前的历史日）
    db
      .select({
        date: sql<string>`to_char(${shortLinkDailyStats.statDate}, 'YYYY-MM-DD')`,
        pv: shortLinkDailyStats.pv,
        uv: shortLinkDailyStats.uv,
      })
      .from(shortLinkDailyStats)
      .where(eq(shortLinkDailyStats.linkId, id)),
    dimensionBreakdown(id, since, 'deviceType'),
    dimensionBreakdown(id, since, 'browser'),
    dimensionBreakdown(id, since, 'province'),
    refererBreakdown(id, since),
  ]);

  // 双源按日合并：同日取 max（聚合覆盖的历史日两源数值一致，未聚合的新增日由明细兜底）
  const byDay = new Map<string, DayAgg>();
  for (const row of [...rolledDays, ...clickDays]) {
    const pv = Number(row.pv);
    const uv = Number(row.uv);
    const prev = byDay.get(row.date);
    byDay.set(row.date, { pv: Math.max(prev?.pv ?? 0, pv), uv: Math.max(prev?.uv ?? 0, uv) });
  }

  let totalPv = 0;
  let totalUv = 0;
  for (const agg of byDay.values()) {
    totalPv += agg.pv;
    totalUv += agg.uv;
  }

  const todayKey = formatDate(startOfToday());
  const today = byDay.get(todayKey);

  // 趋势按窗口补零，保证图表 x 轴连续
  const trend: ShortLinkTrendPoint[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = formatDate(d);
    const point = byDay.get(key);
    trend.push({ date: key, pv: point?.pv ?? 0, uv: point?.uv ?? 0 });
  }

  return {
    totals: {
      pv: totalPv,
      uv: totalUv,
      todayPv: today?.pv ?? 0,
      todayUv: today?.uv ?? 0,
    },
    trend,
    devices,
    browsers,
    regions,
    referers,
  };
}
