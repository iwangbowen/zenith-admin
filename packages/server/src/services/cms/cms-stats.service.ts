import { createHash } from 'node:crypto';
import { and, eq, gte, sql, desc, inArray, isNotNull, lt } from 'drizzle-orm';
import { db } from '../../db';
import { cmsVisitLogs, cmsSearchLogs, cmsAdStats, cmsAds, cmsContents } from '../../db/schema';
import logger from '../../lib/logger';
import { formatDate } from '../../lib/datetime';
import { assertSiteAccess } from './cms-sites.service';
import { ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';

/** 原始统计日志保留天数（访问 / 搜索） */
const LOG_RETENTION_DAYS = 90;

export type CmsDeviceType = 'pc' | 'mobile' | 'bot';

/** UA → 设备类型（bot 优先，供报表区分爬虫流量） */
export function detectDeviceType(userAgent: string | null | undefined): CmsDeviceType {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua || /bot|spider|crawl|slurp|fetch|monitor|curl|wget|python-requests/.test(ua)) return 'bot';
  if (/mobile|android|iphone|ipad|ipod|harmonyos|miniprogram/.test(ua)) return 'mobile';
  return 'pc';
}

/** referrer → 来源 Host（同站/无来源返回 null） */
function parseReferrerHost(referrer: string | null | undefined, selfHost: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).host.toLowerCase();
    if (!host || (selfHost && host === selfHost.toLowerCase())) return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

/** 站内路径 → 页面类型（静态命中场景无渲染 kind 时推断） */
export function pageKindFromPath(sitePath: string): string {
  const p = sitePath.replace(/^\/+|\/+$/g, '');
  if (p === '' || p === 'index.html') return 'home';
  if (p.startsWith('tag/')) return 'tag';
  if (p.startsWith('p/')) return 'page';
  if (p.startsWith('survey/')) return 'page';
  if (p === 'search') return 'search';
  if (/index_\d+\.html$/.test(p) || !p.endsWith('.html')) return 'list';
  return 'detail';
}

export interface RecordVisitInput {
  siteId: number;
  /** 站内相对路径（不含前导 /） */
  sitePath: string;
  pageKind: string;
  contentId?: number | null;
  channelCode: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  /** 请求 Host（排除同站 referrer 用） */
  host: string | null;
}

/**
 * 记录一次前台访问（fire-and-forget，失败仅告警）：
 * 静态命中与 SSR 渲染统一在响应路径埋点，visitorHash = md5(ip+ua) 供 UV 去重。
 */
export function recordCmsVisit(input: RecordVisitInput): void {
  const deviceType = detectDeviceType(input.userAgent);
  const visitorHash = createHash('md5').update(`${input.ip ?? ''}|${input.userAgent ?? ''}`).digest('hex');
  void db.insert(cmsVisitLogs).values({
    siteId: input.siteId,
    path: `/${input.sitePath}`.slice(0, 500),
    pageKind: input.pageKind.slice(0, 20),
    contentId: input.contentId ?? null,
    channelCode: input.channelCode.slice(0, 50),
    visitorHash,
    ip: input.ip?.slice(0, 64) ?? null,
    deviceType,
    referrerHost: parseReferrerHost(input.referrer, input.host),
  }).catch((err) => {
    logger.warn('[CMS] 访问日志写入失败', err);
  });
}

/** 记录前台搜索日志（fire-and-forget） */
export function recordCmsSearchLog(input: { siteId: number; keyword: string; resultCount: number; ip: string | null; userAgent: string | null }): void {
  if (!input.keyword.trim()) return;
  void db.insert(cmsSearchLogs).values({
    siteId: input.siteId,
    keyword: input.keyword.trim().slice(0, 64),
    resultCount: input.resultCount,
    ip: input.ip?.slice(0, 64) ?? null,
    deviceType: detectDeviceType(input.userAgent),
  }).catch((err) => {
    logger.warn('[CMS] 搜索日志写入失败', err);
  });
}

/** 广告曝光批量上报：cms_ads.view_count 累加 + 日聚合 upsert（单次最多 50 条） */
export async function recordAdViews(ids: number[]): Promise<void> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 50);
  if (unique.length === 0) return;
  const ads = await db.select({ id: cmsAds.id }).from(cmsAds)
    .where(inArray(cmsAds.id, unique));
  const validIds = new Set(ads.map((ad) => ad.id));
  const today = formatDate(new Date());
  for (const adId of unique) {
    if (!validIds.has(adId)) continue;
    await db.update(cmsAds).set({ viewCount: sql`${cmsAds.viewCount} + 1` }).where(and(
      eq(cmsAds.id, adId),
    ));
    await db.insert(cmsAdStats)
      .values({ adId, statDate: today, views: 1 })
      .onConflictDoUpdate({
        target: [cmsAdStats.adId, cmsAdStats.statDate],
        set: { views: sql`${cmsAdStats.views} + 1` },
      });
  }
}

/** 广告点击日聚合（recordAdClick 成功后调用） */
export function recordAdClickStat(adId: number): void {
  const today = formatDate(new Date());
  void db.select({ id: cmsAds.id }).from(cmsAds).where(eq(cmsAds.id, adId)).limit(1)
    .then(async ([ad]) => {
      if (!ad) return;
      await db.insert(cmsAdStats)
        .values({ adId, statDate: today, clicks: 1 })
        .onConflictDoUpdate({
          target: [cmsAdStats.adId, cmsAdStats.statDate],
          set: { clicks: sql`${cmsAdStats.clicks} + 1` },
        });
    })
    .catch((err) => {
      logger.warn('[CMS] 广告点击日聚合写入失败', err);
    });
}

// ─── 报表 ─────────────────────────────────────────────────────────────────────
const dateExpr = sql<string>`to_char(${cmsVisitLogs.createdAt}, 'YYYY-MM-DD')`;

function sinceDate(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

/** 访问统计总览：今日/昨日卡片 + 趋势 + 内容TOP + 栏目/来源/设备/通道分布（bot 不计入） */
export async function getCmsVisitStats(siteId: number, days = 30) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  const rangeDays = Math.min(90, Math.max(1, days));
  const since = sinceDate(rangeDays);
  const base = and(
    eq(cmsVisitLogs.siteId, siteId),
    gte(cmsVisitLogs.createdAt, since),
    sql`${cmsVisitLogs.deviceType} <> 'bot'`,
  )!;

  const [trendRows, deviceRows, referrerRows, channelRows, topContentRows] = await Promise.all([
    db.select({
      date: dateExpr,
      pv: sql<number>`count(*)::int`,
      uv: sql<number>`count(distinct ${cmsVisitLogs.visitorHash})::int`,
      ips: sql<number>`count(distinct coalesce(${cmsVisitLogs.ip}, ${cmsVisitLogs.visitorHash}))::int`,
    }).from(cmsVisitLogs).where(base).groupBy(dateExpr).orderBy(dateExpr),
    db.select({
      deviceType: cmsVisitLogs.deviceType,
      pv: sql<number>`count(*)::int`,
    }).from(cmsVisitLogs)
      .where(and(eq(cmsVisitLogs.siteId, siteId), gte(cmsVisitLogs.createdAt, since)))
      .groupBy(cmsVisitLogs.deviceType),
    db.select({
      host: cmsVisitLogs.referrerHost,
      pv: sql<number>`count(*)::int`,
    }).from(cmsVisitLogs)
      .where(and(base, isNotNull(cmsVisitLogs.referrerHost)))
      .groupBy(cmsVisitLogs.referrerHost)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db.select({
      channelCode: cmsVisitLogs.channelCode,
      pv: sql<number>`count(*)::int`,
    }).from(cmsVisitLogs).where(base).groupBy(cmsVisitLogs.channelCode).orderBy(desc(sql`count(*)`)),
    db.select({
      contentId: cmsVisitLogs.contentId,
      pv: sql<number>`count(*)::int`,
      uv: sql<number>`count(distinct ${cmsVisitLogs.visitorHash})::int`,
      title: cmsContents.title,
    }).from(cmsVisitLogs)
      .innerJoin(cmsContents, and(
        eq(cmsVisitLogs.contentId, cmsContents.id),
      ))
      .where(and(base, isNotNull(cmsVisitLogs.contentId)))
      .groupBy(cmsVisitLogs.contentId, cmsContents.title)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
  ]);

  // 补全无访问日期（趋势图连续）
  const trendMap = new Map(trendRows.map((r) => [r.date, r]));
  const trend: { date: string; pv: number; uv: number }[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = formatDate(d);
    const hit = trendMap.get(key);
    trend.push({ date: key, pv: hit?.pv ?? 0, uv: hit?.uv ?? 0 });
  }
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 24 * 3600 * 1000));
  const todayRow = trendMap.get(today);
  const yesterdayRow = trendMap.get(yesterday);

  return {
    today: { pv: todayRow?.pv ?? 0, uv: todayRow?.uv ?? 0, ips: todayRow?.ips ?? 0 },
    yesterday: { pv: yesterdayRow?.pv ?? 0, uv: yesterdayRow?.uv ?? 0, ips: yesterdayRow?.ips ?? 0 },
    totalPv: trendRows.reduce((sum, r) => sum + r.pv, 0),
    trend,
    topContents: topContentRows.map((r) => ({ contentId: r.contentId!, title: r.title, pv: r.pv, uv: r.uv })),
    devices: deviceRows.map((r) => ({ deviceType: r.deviceType, pv: r.pv })),
    referrers: referrerRows.map((r) => ({ host: r.host!, pv: r.pv })),
    channels: channelRows.map((r) => ({ channelCode: r.channelCode, pv: r.pv })),
  };
}

/** 搜索分析：搜索量趋势 + 热搜词榜 + 无结果词榜（选题风向标） */
export async function getCmsSearchAnalytics(siteId: number, days = 30) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  const rangeDays = Math.min(90, Math.max(1, days));
  const since = sinceDate(rangeDays);
  const base = and(
    eq(cmsSearchLogs.siteId, siteId),
    gte(cmsSearchLogs.createdAt, since),
  )!;
  const searchDateExpr = sql<string>`to_char(${cmsSearchLogs.createdAt}, 'YYYY-MM-DD')`;

  const [trendRows, topRows, noResultRows] = await Promise.all([
    db.select({ date: searchDateExpr, count: sql<number>`count(*)::int` })
      .from(cmsSearchLogs).where(base).groupBy(searchDateExpr).orderBy(searchDateExpr),
    db.select({
      keyword: cmsSearchLogs.keyword,
      count: sql<number>`count(*)::int`,
      avgResults: sql<number>`round(avg(${cmsSearchLogs.resultCount}))::int`,
    }).from(cmsSearchLogs).where(base).groupBy(cmsSearchLogs.keyword).orderBy(desc(sql`count(*)`)).limit(20),
    db.select({
      keyword: cmsSearchLogs.keyword,
      count: sql<number>`count(*)::int`,
    }).from(cmsSearchLogs)
      .where(and(base, eq(cmsSearchLogs.resultCount, 0)))
      .groupBy(cmsSearchLogs.keyword)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
  ]);

  const trendMap = new Map(trendRows.map((r) => [r.date, r.count]));
  const trend: { date: string; count: number }[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = formatDate(d);
    trend.push({ date: key, count: trendMap.get(key) ?? 0 });
  }

  return {
    total: trendRows.reduce((sum, r) => sum + r.count, 0),
    trend,
    topKeywords: topRows,
    noResultKeywords: noResultRows,
  };
}

/** 清理过期统计原始日志（系统周期任务，访问 + 搜索各保留 90 天） */
export async function cleanupCmsStatLogs(retentionDays = LOG_RETENTION_DAYS): Promise<string> {
  const threshold = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const [visits, searches] = await Promise.all([
    db.delete(cmsVisitLogs).where(lt(cmsVisitLogs.createdAt, threshold)).returning({ id: cmsVisitLogs.id }),
    db.delete(cmsSearchLogs).where(lt(cmsSearchLogs.createdAt, threshold)).returning({ id: cmsSearchLogs.id }),
  ]);
  return `清理访问日志 ${visits.length} 条，搜索日志 ${searches.length} 条`;
}
