import * as z from 'zod';
import { paginated } from '../../core/api-schemas';
import { userBehaviorEventTypeEnum } from '../validation';
import { ANALYTICS_DEVICE_TYPES, ANALYTICS_ENVIRONMENTS, ANALYTICS_EVENT_SOURCES, ANALYTICS_PERF_RATINGS } from '../constants';

// ─── 概览 / 趋势 / 实时 ───────────────────────────────────────────────────────

export const analyticsOverviewSchema = z.object({
  pv: z.int(),
  uv: z.int(),
  sessions: z.int(),
  events: z.int(),
  newUsers: z.int(),
  avgSessionMs: z.int(),
  bounceRate: z.number().meta({ description: '跳出率（百分比）' }),
  avgPagesPerSession: z.number(),
  pvDelta: z.number().meta({ description: '较上一周期变化（百分比）' }),
  uvDelta: z.number(),
  sessionsDelta: z.number(),
  bounceRateDelta: z.number(),
  activeNow: z.int().meta({ description: '近 5 分钟活跃访客数' }),
}).meta({ id: 'AnalyticsOverview' });

export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

const trendSeriesItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  data: z.array(z.number()),
});

export const trendSeriesSchema = z.object({
  dates: z.array(z.string()),
  series: z.array(trendSeriesItemSchema),
  compare: z.object({ dates: z.array(z.string()), series: z.array(trendSeriesItemSchema) }).optional().meta({ description: '上一周期同长区间（compare=true 时返回）' }),
}).meta({ id: 'TrendSeries' });

export type TrendSeries = z.infer<typeof trendSeriesSchema>;

export const realtimeStatsSchema = z.object({
  activeUsers: z.int(),
  pageViewsLast30Min: z.int(),
  eventsLastMinute: z.int(),
  topPages: z.array(z.object({ pagePath: z.string(), pageTitle: z.string().nullable(), active: z.int() })),
  recentEvents: z.array(z.object({
    eventType: userBehaviorEventTypeEnum,
    eventName: z.string().nullable(),
    pagePath: z.string(),
    username: z.string().nullable(),
    createdAt: z.string(),
  })),
  perMinute: z.array(z.object({ minute: z.string().meta({ description: 'HH:mm' }), events: z.int() })),
}).meta({ id: 'RealtimeStats' });

export type RealtimeStats = z.infer<typeof realtimeStatsSchema>;

// ─── 页面停留 / 功能使用 ──────────────────────────────────────────────────────

export const pageStatItemSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string().nullable(),
  visits: z.int(),
  avgMs: z.int().nullable(),
  medianMs: z.int().nullable(),
  p90Ms: z.int().nullable(),
}).meta({ id: 'PageStatItem' });

export type PageStatItem = z.infer<typeof pageStatItemSchema>;

/** 分页列表之外还带全量汇总（不受分页影响） */
export const pageStatsSchema = paginated(pageStatItemSchema).extend({
  totalVisits: z.int(),
  avgDwellMs: z.int().nullable(),
}).meta({ id: 'PageStats' });

export type PageStats = z.infer<typeof pageStatsSchema>;

export const featureStatItemSchema = z.object({
  pagePath: z.string(),
  elementKey: z.string(),
  elementLabel: z.string().nullable(),
  componentArea: z.string().nullable(),
  count: z.int(),
}).meta({ id: 'FeatureStatItem' });

export type FeatureStatItem = z.infer<typeof featureStatItemSchema>;

export const featureStatsSchema = paginated(featureStatItemSchema).extend({
  totalEvents: z.int(),
}).meta({ id: 'FeatureStats' });

export type FeatureStats = z.infer<typeof featureStatsSchema>;

// ─── 点击热力图 ───────────────────────────────────────────────────────────────

/** 落点分箱：坐标为分箱中心的视口/容器百分比 */
export const analyticsHeatmapPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  value: z.number(),
  topLabel: z.string().nullable().meta({ description: '该分箱内出现次数最多的元素文案' }),
  topElementKey: z.string().nullable().meta({ description: '该分箱内出现次数最多的元素 key，用于与挫败点击榜单关联' }),
  topArea: z.string().nullable().meta({ description: '该分箱内出现次数最多的 UI 区域' }),
  uniqueUsers: z.int().meta({ description: '落在该分箱的独立访客数' }),
  repeatRate: z.number().meta({ description: '人均重复点击 = value / uniqueUsers' }),
  rage: z.boolean().meta({ description: '该分箱的主元素是否出现在挫败点击榜单中' }),
}).meta({ id: 'AnalyticsHeatmapPoint' });

export type AnalyticsHeatmapPoint = z.infer<typeof analyticsHeatmapPointSchema>;

/** 点击热点元素（按 elementKey 聚合） */
export const heatmapElementItemSchema = z.object({
  elementKey: z.string(),
  elementLabel: z.string().nullable(),
  componentArea: z.string().nullable(),
  count: z.int(),
  uniqueUsers: z.int(),
  avgX: z.number().nullable().meta({ description: '平均落点（仅统计带坐标的点击；全部无坐标时为 null）' }),
  avgY: z.number().nullable(),
}).meta({ id: 'HeatmapElementItem' });

export type HeatmapElementItem = z.infer<typeof heatmapElementItemSchema>;

/** 挫败点击（rage click）热点元素 */
export const heatmapRageClickItemSchema = z.object({
  elementKey: z.string().nullable(),
  elementLabel: z.string().nullable(),
  count: z.int(),
  uniqueUsers: z.int(),
  lastAt: z.string().nullable(),
}).meta({ id: 'HeatmapRageClickItem' });

export type HeatmapRageClickItem = z.infer<typeof heatmapRageClickItemSchema>;

export const heatmapDataSchema = z.object({
  pagePath: z.string(),
  componentArea: z.string().meta({ description: '区域筛选值；全页模式为空串' }),
  points: z.array(analyticsHeatmapPointSchema),
  total: z.int(),
  uniqueUsers: z.int().meta({ description: '产生点击的独立访客数（distinctId 去重）' }),
  uniqueSessions: z.int(),
  avgClicksPerUser: z.number(),
  topElements: z.array(heatmapElementItemSchema),
  rageClicks: z.array(heatmapRageClickItemSchema).meta({ description: '该页面的挫败点击热点（不受区域筛选影响）' }),
}).meta({ id: 'HeatmapData' });

export type HeatmapData = z.infer<typeof heatmapDataSchema>;

export const heatmapPageListItemSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string().nullable(),
  areas: z.array(z.string()),
}).meta({ id: 'HeatmapPageListItem' });

export type HeatmapPageListItem = z.infer<typeof heatmapPageListItemSchema>;

export const heatmapPageListSchema = z.object({
  pages: z.array(heatmapPageListItemSchema),
}).meta({ id: 'HeatmapPageList' });

export type HeatmapPageList = z.infer<typeof heatmapPageListSchema>;

// ─── 用户行为统计 / 时间线 ────────────────────────────────────────────────────

export const analyticsUserStatItemSchema = z.object({
  userId: z.int().nullable(),
  username: z.string().nullable(),
  totalEvents: z.int(),
  pageViews: z.int(),
  uniquePages: z.int(),
  featureUses: z.int(),
  totalDwellMs: z.int().nullable(),
  lastActiveAt: z.string().nullable(),
}).meta({ id: 'AnalyticsUserStatItem' });

export type AnalyticsUserStatItem = z.infer<typeof analyticsUserStatItemSchema>;

export const analyticsUserStatsSchema = paginated(analyticsUserStatItemSchema).meta({ id: 'AnalyticsUserStats' });

export type AnalyticsUserStats = z.infer<typeof analyticsUserStatsSchema>;

export const analyticsUserTimelineEventSchema = z.object({
  id: z.int(),
  eventType: userBehaviorEventTypeEnum,
  eventName: z.string().nullable(),
  pagePath: z.string(),
  pageTitle: z.string().nullable(),
  elementLabel: z.string().nullable(),
  componentArea: z.string().nullable(),
  durationMs: z.int().nullable(),
  sessionId: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
}).meta({ id: 'AnalyticsUserTimelineEvent' });

export type AnalyticsUserTimelineEvent = z.infer<typeof analyticsUserTimelineEventSchema>;

export const analyticsUserTimelineSchema = z.object({
  userId: z.int().nullable(),
  username: z.string().nullable(),
  totalEvents: z.int(),
  firstSeenAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  items: z.array(analyticsUserTimelineEventSchema),
}).meta({ id: 'AnalyticsUserTimeline' });

export type AnalyticsUserTimeline = z.infer<typeof analyticsUserTimelineSchema>;

// ─── 会话 ─────────────────────────────────────────────────────────────────────

export const sessionListItemSchema = z.object({
  id: z.int(),
  sessionId: z.string(),
  userId: z.int().nullable(),
  username: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.int(),
  pageCount: z.int(),
  eventCount: z.int(),
  entryPage: z.string().nullable(),
  exitPage: z.string().nullable(),
  referrer: z.string().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  deviceType: z.enum(ANALYTICS_DEVICE_TYPES).nullable(),
  region: z.string().nullable(),
  isBounce: z.boolean(),
  memberId: z.int().nullable(),
  source: z.enum(ANALYTICS_EVENT_SOURCES),
  appId: z.string(),
  environment: z.enum(ANALYTICS_ENVIRONMENTS),
}).meta({ id: 'SessionListItem' });

export type SessionListItem = z.infer<typeof sessionListItemSchema>;

export const sessionTimelineEventSchema = z.object({
  id: z.int(),
  eventType: userBehaviorEventTypeEnum,
  eventName: z.string().nullable(),
  pagePath: z.string(),
  pageTitle: z.string().nullable(),
  elementLabel: z.string().nullable(),
  componentArea: z.string().nullable(),
  durationMs: z.int().nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
}).meta({ id: 'SessionTimelineEvent' });

export type SessionTimelineEvent = z.infer<typeof sessionTimelineEventSchema>;

/** 单会话事件序列；会话聚合行缺失时会话级字段为 null */
export const sessionTimelineSchema = z.object({
  sessionId: z.string(),
  username: z.string().nullable(),
  userId: z.int().nullable(),
  startedAt: z.string().nullable(),
  durationMs: z.int().nullable(),
  entryPage: z.string().nullable(),
  deviceType: z.enum(ANALYTICS_DEVICE_TYPES).nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  items: z.array(sessionTimelineEventSchema),
}).meta({ id: 'SessionTimeline' });

export type SessionTimeline = z.infer<typeof sessionTimelineSchema>;

// ─── 路径分析 ─────────────────────────────────────────────────────────────────

export const pathNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.int(),
}).meta({ id: 'PathNode' });

export type PathNode = z.infer<typeof pathNodeSchema>;

export const pathLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  value: z.int(),
  cyclic: z.boolean().meta({ description: '回边标记：桑基图只渲染非回边，明细表仍完整展示' }),
}).meta({ id: 'PathLink' });

export type PathLink = z.infer<typeof pathLinkSchema>;

export const pathResultSchema = z.object({
  nodes: z.array(pathNodeSchema),
  links: z.array(pathLinkSchema),
  totalTransitions: z.int().meta({ description: '全部相邻跳转次数（含被 limit 截断与回边的部分）' }),
  cyclicValue: z.int().meta({ description: '因破环而未进入桑基图的跳转次数' }),
}).meta({ id: 'PathResult' });

export type PathResult = z.infer<typeof pathResultSchema>;

// ─── 性能（Web Vitals）────────────────────────────────────────────────────────

export const perfStatItemSchema = z.object({
  metricName: z.string(),
  count: z.int(),
  avg: z.number().nullable(),
  p75: z.number().nullable(),
  p90: z.number().nullable(),
  p99: z.number().nullable(),
  rating: z.enum(ANALYTICS_PERF_RATINGS),
}).meta({ id: 'PerfStatItem' });

export type PerfStatItem = z.infer<typeof perfStatItemSchema>;

export const perfStatsSchema = z.object({
  items: z.array(perfStatItemSchema),
}).meta({ id: 'PerfStats' });

export type PerfStats = z.infer<typeof perfStatsSchema>;
