import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { CMS_DEVICE_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

const cmsDayMetricSchema = z.object({ pv: z.int(), uv: z.int(), ips: z.int() });

/** CMS 访问统计总览（bot 流量不计入） */
export const cmsVisitStatsSchema = z.object({
  today: cmsDayMetricSchema,
  yesterday: cmsDayMetricSchema,
  totalPv: z.int().meta({ description: '统计区间累计 PV（不含爬虫）' }),
  trend: z.array(z.object({ date: z.string(), pv: z.int(), uv: z.int() })),
  topContents: z.array(z.object({
    contentId: z.int(),
    title: z.string(),
    pv: z.int(),
    uv: z.int(),
  })),
  devices: z.array(z.object({ deviceType: z.enum(CMS_DEVICE_TYPES), pv: z.int() })),
  referrers: z.array(z.object({ host: z.string(), pv: z.int() })),
}).meta({ id: 'CmsVisitStats' });

export type CmsVisitStats = z.infer<typeof cmsVisitStatsSchema>;

/** CMS 搜索分析 */
export const cmsSearchAnalyticsSchema = z.object({
  total: z.int(),
  trend: z.array(z.object({ date: z.string(), count: z.int() })),
  topKeywords: z.array(z.object({ keyword: z.string(), count: z.int(), avgResults: z.int() })),
  noResultKeywords: z.array(z.object({ keyword: z.string(), count: z.int() })).meta({ description: '无结果搜索词榜（内容选题参考）' }),
}).meta({ id: 'CmsSearchAnalytics' });

export type CmsSearchAnalytics = z.infer<typeof cmsSearchAnalyticsSchema>;

/** CMS 数据看板统计 */
export const cmsDashboardStatsSchema = z.object({
  totals: z.object({
    published: z.int(),
    draft: z.int(),
    pending: z.int(),
    offline: z.int(),
    rejected: z.int(),
    recycled: z.int(),
  }),
  pendingComments: z.int(),
  todayPublished: z.int(),
  totalViews: z.int(),
  publishTrend: z.array(z.object({ date: z.string(), count: z.int() })),
  topViewed: z.array(z.object({
    id: z.int(),
    title: z.string(),
    viewCount: z.int(),
    channelName: z.string().nullable(),
  })),
  channelDistribution: z.array(z.object({
    channelId: z.int(),
    channelName: z.string(),
    count: z.int(),
  })),
}).meta({ id: 'CmsDashboardStats' });

export type CmsDashboardStats = z.infer<typeof cmsDashboardStatsSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsStatsQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const cmsDashboardQuery = z.object({
  siteId: z.coerce.number().int().positive(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsStatContract = defineContract('/api/cms/stats', {
  visits: op.get('/visits', { query: cmsStatsQuery, response: cmsVisitStatsSchema, summary: '访问统计总览（今日/昨日卡片 + PV/UV 趋势 + 内容TOP + 来源/设备/通道分布）' }),
  search: op.get('/search', { query: cmsStatsQuery, response: cmsSearchAnalyticsSchema, summary: '搜索分析（搜索量趋势 + 热搜词榜 + 无结果词榜）' }),
}, { tags: ['CMS-访问统计'] });

export const cmsDashboardContract = defineContract('/api/cms/dashboard', {
  stats: op.get('/stats', { query: cmsDashboardQuery, response: cmsDashboardStatsSchema, summary: 'CMS 数据看板统计' }),
}, { tags: ['CMS-内容管理'] });
