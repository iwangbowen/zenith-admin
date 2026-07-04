/**
 * 数据分析 / 埋点 DTO
 */
import { z } from '@hono/zod-openapi';

const eventTypeEnum = z.enum([
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
]);
const deviceTypeEnum = z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']);
const metaStatusEnum = z.enum(['active', 'deprecated', 'blocked']);

// ─── 埋点上报 ─────────────────────────────────────────────────────────────────
export const UserEventInputDTO = z
  .object({
    sessionId: z.string().max(36),
    anonymousId: z.string().max(64).optional(),
    distinctId: z.string().max(64).optional(),
    eventType: eventTypeEnum,
    eventName: z.string().max(128).optional(),
    pagePath: z.string().max(256),
    pageTitle: z.string().max(128).optional(),
    elementKey: z.string().max(128).optional(),
    elementLabel: z.string().max(128).optional(),
    componentArea: z.string().max(64).optional(),
    clickX: z.number().min(0).max(100).optional(),
    clickY: z.number().min(0).max(100).optional(),
    scrollDepth: z.number().int().min(0).max(100).optional(),
    durationMs: z.number().int().min(0).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    referrer: z.string().max(512).optional(),
    utmSource: z.string().max(128).optional(),
    utmMedium: z.string().max(128).optional(),
    utmCampaign: z.string().max(128).optional(),
    utmTerm: z.string().max(128).optional(),
    utmContent: z.string().max(128).optional(),
    screenW: z.number().int().optional(),
    screenH: z.number().int().optional(),
    language: z.string().max(16).optional(),
    metricName: z.string().max(32).optional(),
    metricValue: z.number().optional(),
    ts: z.number().int().positive().optional(),
  })
  .openapi('UserEventInput');

export const BatchUserEventsBodyDTO = z
  .object({ events: z.array(UserEventInputDTO).min(1).max(100) })
  .openapi('BatchUserEventsBody');

export const AnalyticsPublicConfigDTO = z
  .object({
    enabled: z.boolean(),
    sampleRate: z.number(),
    trackPageviews: z.boolean(),
    trackClicks: z.boolean(),
    trackPerformance: z.boolean(),
    trackErrors: z.boolean(),
    trackApi: z.boolean(),
    maskInputs: z.boolean(),
    respectDnt: z.boolean(),
    blacklistPaths: z.array(z.string()),
  })
  .openapi('AnalyticsPublicConfig');

// ─── 概览 / 趋势 ──────────────────────────────────────────────────────────────
export const AnalyticsOverviewDTO = z
  .object({
    pv: z.number().int(),
    uv: z.number().int(),
    sessions: z.number().int(),
    events: z.number().int(),
    newUsers: z.number().int(),
    avgSessionMs: z.number().int(),
    bounceRate: z.number(),
    avgPagesPerSession: z.number(),
    pvDelta: z.number(),
    uvDelta: z.number(),
    sessionsDelta: z.number(),
    bounceRateDelta: z.number(),
    activeNow: z.number().int(),
  })
  .openapi('AnalyticsOverview');

const TrendSeriesItemDTO = z.object({ key: z.string(), name: z.string(), data: z.array(z.number()) });

export const TrendSeriesDTO = z
  .object({
    dates: z.array(z.string()),
    series: z.array(TrendSeriesItemDTO),
    compare: z.object({ dates: z.array(z.string()), series: z.array(TrendSeriesItemDTO) }).optional(),
  })
  .openapi('TrendSeries');

// ─── 页面停留 ─────────────────────────────────────────────────────────────────
export const PageStatItemDTO = z
  .object({
    pagePath: z.string(),
    pageTitle: z.string().nullable(),
    visits: z.number().int(),
    avgMs: z.number().int().nullable(),
    medianMs: z.number().int().nullable(),
    p90Ms: z.number().int().nullable(),
  })
  .openapi('PageStatItem');

export const PageStatsDTO = z
  .object({ items: z.array(PageStatItemDTO), totalVisits: z.number().int(), avgDwellMs: z.number().int().nullable() })
  .openapi('PageStats');

// ─── 功能使用 ─────────────────────────────────────────────────────────────────
export const FeatureStatItemDTO = z
  .object({
    pagePath: z.string(),
    elementKey: z.string(),
    elementLabel: z.string().nullable(),
    componentArea: z.string().nullable(),
    count: z.number().int(),
  })
  .openapi('FeatureStatItem');

export const FeatureStatsDTO = z
  .object({ items: z.array(FeatureStatItemDTO), totalEvents: z.number().int() })
  .openapi('FeatureStats');

// ─── 热力图 ───────────────────────────────────────────────────────────────────
export const HeatmapPointDTO = z.object({ x: z.number(), y: z.number(), value: z.number() }).openapi('HeatmapPoint');
export const HeatmapDataDTO = z
  .object({ pagePath: z.string(), componentArea: z.string(), points: z.array(HeatmapPointDTO), total: z.number().int() })
  .openapi('HeatmapData');
export const HeatmapPageListDTO = z
  .object({
    pages: z.array(z.object({ pagePath: z.string(), pageTitle: z.string().nullable(), areas: z.array(z.string()) })),
  })
  .openapi('HeatmapPageList');

// ─── 用户统计 ─────────────────────────────────────────────────────────────────
export const UserStatItemDTO = z
  .object({
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    totalEvents: z.number().int(),
    pageViews: z.number().int(),
    uniquePages: z.number().int(),
    featureUses: z.number().int(),
    totalDwellMs: z.number().int().nullable(),
    lastActiveAt: z.string().nullable(),
  })
  .openapi('UserStatItem');
export const UserStatsDTO = z
  .object({ items: z.array(UserStatItemDTO), totalUsers: z.number().int() })
  .openapi('UserStats');

// ─── 会话 ─────────────────────────────────────────────────────────────────────
export const SessionListItemDTO = z
  .object({
    id: z.number().int(),
    sessionId: z.string(),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    startedAt: z.string(),
    endedAt: z.string(),
    durationMs: z.number().int(),
    pageCount: z.number().int(),
    eventCount: z.number().int(),
    entryPage: z.string().nullable(),
    exitPage: z.string().nullable(),
    referrer: z.string().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    deviceType: deviceTypeEnum.nullable(),
    region: z.string().nullable(),
    isBounce: z.boolean(),
  })
  .openapi('SessionListItem');

// ─── 漏斗 ─────────────────────────────────────────────────────────────────────
export const FunnelResultDTO = z
  .object({
    steps: z.array(
      z.object({
        label: z.string(),
        users: z.number().int(),
        conversionRate: z.number(),
        stepConversionRate: z.number(),
        dropoff: z.number().int(),
      }),
    ),
    totalUsers: z.number().int(),
    overallConversionRate: z.number(),
  })
  .openapi('FunnelResult');

// ─── 留存 ─────────────────────────────────────────────────────────────────────
export const RetentionResultDTO = z
  .object({
    cohorts: z.array(
      z.object({
        cohortDate: z.string(),
        cohortSize: z.number().int(),
        values: z.array(z.number().nullable()),
      }),
    ),
    periods: z.array(z.number().int()),
  })
  .openapi('RetentionResult');

// ─── 路径 ─────────────────────────────────────────────────────────────────────
export const PathResultDTO = z
  .object({
    nodes: z.array(z.object({ id: z.string(), label: z.string(), value: z.number().int() })),
    links: z.array(z.object({ source: z.string(), target: z.string(), value: z.number().int() })),
  })
  .openapi('PathResult');

// ─── 用户行为时间线 ───────────────────────────────────────────────────────────
export const UserTimelineEventDTO = z
  .object({
    id: z.number().int(),
    eventType: eventTypeEnum,
    eventName: z.string().nullable(),
    pagePath: z.string(),
    pageTitle: z.string().nullable(),
    elementLabel: z.string().nullable(),
    componentArea: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    sessionId: z.string().nullable(),
    properties: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
  })
  .openapi('UserTimelineEvent');
export const UserTimelineDTO = z
  .object({
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    totalEvents: z.number().int(),
    firstSeenAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    items: z.array(UserTimelineEventDTO),
  })
  .openapi('UserTimeline');

// ─── 会话时间轴 ───────────────────────────────────────────────────────────────
export const SessionTimelineEventDTO = z
  .object({
    id: z.number().int(),
    eventType: eventTypeEnum,
    eventName: z.string().nullable(),
    pagePath: z.string(),
    pageTitle: z.string().nullable(),
    elementLabel: z.string().nullable(),
    componentArea: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    properties: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
  })
  .openapi('SessionTimelineEvent');
export const SessionTimelineDTO = z
  .object({
    sessionId: z.string(),
    username: z.string().nullable(),
    userId: z.number().int().nullable(),
    startedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    entryPage: z.string().nullable(),
    deviceType: z.string().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    items: z.array(SessionTimelineEventDTO),
  })
  .openapi('SessionTimeline');

// ─── 保存的分析报表 ───────────────────────────────────────────────────────────
export const AnalyticsSavedReportDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    reportType: z.string(),
    config: z.record(z.string(), z.unknown()),
    createdBy: z.number().int().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('AnalyticsSavedReport');
export const CreateAnalyticsSavedReportDTO = z
  .object({
    name: z.string().min(1).max(128),
    reportType: z.enum(['funnel']).default('funnel'),
    config: z.record(z.string(), z.unknown()),
  })
  .openapi('CreateAnalyticsSavedReport');

// ─── 维度分布 ─────────────────────────────────────────────────────────────────
export const DimensionBreakdownDTO = z
  .object({
    dimension: z.string(),
    total: z.number().int(),
    items: z.array(z.object({ name: z.string(), value: z.number().int(), percent: z.number() })),
  })
  .openapi('DimensionBreakdown');

export const DimensionCrossDTO = z
  .object({
    dim1: z.string(),
    dim2: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.object({ name: z.string(), total: z.number().int(), values: z.array(z.number().int()) })),
  })
  .openapi('DimensionCross');

// ─── 性能 ─────────────────────────────────────────────────────────────────────
export const PerfStatsDTO = z
  .object({
    items: z.array(
      z.object({
        metricName: z.string(),
        count: z.number().int(),
        avg: z.number().nullable(),
        p75: z.number().nullable(),
        p90: z.number().nullable(),
        p99: z.number().nullable(),
        rating: z.enum(['good', 'needs-improvement', 'poor']),
      }),
    ),
  })
  .openapi('PerfStats');

// ─── 实时 ─────────────────────────────────────────────────────────────────────
export const RealtimeStatsDTO = z
  .object({
    activeUsers: z.number().int(),
    pageViewsLast30Min: z.number().int(),
    eventsLastMinute: z.number().int(),
    topPages: z.array(z.object({ pagePath: z.string(), pageTitle: z.string().nullable(), active: z.number().int() })),
    recentEvents: z.array(
      z.object({
        eventType: eventTypeEnum,
        eventName: z.string().nullable(),
        pagePath: z.string(),
        username: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
    perMinute: z.array(z.object({ minute: z.string(), events: z.number().int() })),
  })
  .openapi('RealtimeStats');

// ─── 事件列表 / 详情 ──────────────────────────────────────────────────────────
export const EventListItemDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    eventType: eventTypeEnum,
    eventName: z.string().nullable(),
    pagePath: z.string(),
    pageTitle: z.string().nullable(),
    elementKey: z.string().nullable(),
    elementLabel: z.string().nullable(),
    componentArea: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    deviceType: deviceTypeEnum.nullable(),
    region: z.string().nullable(),
    sessionId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('EventListItem');

export const EventDetailDTO = z
  .object({
    id: z.number().int(),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    eventType: eventTypeEnum,
    eventName: z.string().nullable(),
    pagePath: z.string(),
    pageTitle: z.string().nullable(),
    elementKey: z.string().nullable(),
    elementLabel: z.string().nullable(),
    componentArea: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    deviceType: deviceTypeEnum.nullable(),
    region: z.string().nullable(),
    sessionId: z.string().nullable(),
    createdAt: z.string(),
    distinctId: z.string().nullable(),
    anonymousId: z.string().nullable(),
    scrollDepth: z.number().int().nullable(),
    properties: z.record(z.string(), z.unknown()).nullable(),
    referrer: z.string().nullable(),
    utmSource: z.string().nullable(),
    utmMedium: z.string().nullable(),
    utmCampaign: z.string().nullable(),
    browserVersion: z.string().nullable(),
    osVersion: z.string().nullable(),
    screenW: z.number().int().nullable(),
    screenH: z.number().int().nullable(),
    language: z.string().nullable(),
    userAgent: z.string().nullable(),
    ip: z.string().nullable(),
    country: z.string().nullable(),
    city: z.string().nullable(),
    metricName: z.string().nullable(),
    metricValue: z.number().nullable(),
  })
  .openapi('EventDetail');

// ─── 事件元数据 ───────────────────────────────────────────────────────────────
export const AnalyticsEventMetaDTO = z
  .object({
    id: z.number().int(),
    eventName: z.string(),
    displayName: z.string().nullable(),
    category: z.string().nullable(),
    description: z.string().nullable(),
    propertySchema: z
      .array(z.object({ key: z.string(), type: z.string(), description: z.string().optional() }))
      .nullable(),
    status: metaStatusEnum,
    eventCount: z.number().int(),
    firstSeenAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsEventMeta');

export const CreateAnalyticsEventMetaDTO = z
  .object({
    eventName: z.string().min(1).max(128),
    displayName: z.string().max(128).nullable().optional(),
    category: z.string().max(64).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    propertySchema: z
      .array(z.object({ key: z.string().max(64), type: z.string().max(32), description: z.string().max(256).optional() }))
      .nullable()
      .optional(),
    status: metaStatusEnum.default('active'),
  })
  .openapi('CreateAnalyticsEventMeta');
export const UpdateAnalyticsEventMetaDTO = CreateAnalyticsEventMetaDTO.partial().openapi('UpdateAnalyticsEventMeta');

// ─── 采集设置 ─────────────────────────────────────────────────────────────────
export const AnalyticsSettingsDTO = z
  .object({
    id: z.number().int(),
    enabled: z.boolean(),
    sampleRate: z.number(),
    trackPageviews: z.boolean(),
    trackClicks: z.boolean(),
    trackPerformance: z.boolean(),
    trackErrors: z.boolean(),
    trackApi: z.boolean(),
    maskInputs: z.boolean(),
    respectDnt: z.boolean(),
    anonymizeIp: z.boolean(),
    blacklistPaths: z.array(z.string()),
    retentionDays: z.number().int(),
    errorRetentionDays: z.number().int(),
    sessionTimeoutMinutes: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsSettings');

export const UpdateAnalyticsSettingsDTO = z
  .object({
    enabled: z.boolean().optional(),
    sampleRate: z.number().min(0).max(1).optional(),
    trackPageviews: z.boolean().optional(),
    trackClicks: z.boolean().optional(),
    trackPerformance: z.boolean().optional(),
    trackErrors: z.boolean().optional(),
    trackApi: z.boolean().optional(),
    maskInputs: z.boolean().optional(),
    respectDnt: z.boolean().optional(),
    anonymizeIp: z.boolean().optional(),
    blacklistPaths: z.array(z.string().max(256)).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    errorRetentionDays: z.number().int().min(1).max(3650).optional(),
    sessionTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .openapi('UpdateAnalyticsSettings');

// ─── 每日聚合（数据管理）──────────────────────────────────────────────────────
export const AnalyticsRollupItemDTO = z
  .object({
    statDate: z.string(),
    pv: z.number().int(),
    uv: z.number().int(),
    sessions: z.number().int(),
    events: z.number().int(),
    bounceSessions: z.number().int(),
    totalDwellMs: z.number().int(),
  })
  .openapi('AnalyticsRollupItem');
export const AnalyticsRollupSummaryDTO = z.object({ items: z.array(AnalyticsRollupItemDTO) }).openapi('AnalyticsRollupSummary');

// ─── 漏斗查询体 ───────────────────────────────────────────────────────────────
export const FunnelQueryBodyDTO = z
  .object({
    days: z.number().int().min(1).max(365).default(30),
    steps: z
      .array(
        z.object({
          eventType: eventTypeEnum.optional(),
          eventName: z.string().max(128).optional(),
          pagePath: z.string().max(256).optional(),
          elementKey: z.string().max(128).optional(),
          label: z.string().max(64),
        }),
      )
      .min(2)
      .max(10),
  })
  .openapi('FunnelQueryBody');
