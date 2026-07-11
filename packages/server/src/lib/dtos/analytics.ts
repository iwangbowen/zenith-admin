/**
 * 数据分析 / 埋点 DTO
 */
import { z } from '@hono/zod-openapi';
import {
  ANALYTICS_PROPERTIES_MAX_BYTES,
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_EVENT_PROPERTY_TYPES,
  ANALYTICS_EVENT_SOURCES,
  ANALYTICS_IDENTITY_TYPES,
  ANALYTICS_QUALITY_ISSUE_TYPES,
  ANALYTICS_SEGMENT_COMPARE_OPS,
  ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS,
  ANALYTICS_EVENT_QUERY_METRICS,
  ANALYTICS_RETENTION_MODES,
  ANALYTICS_CAMPAIGN_CHANNELS,
  ANALYTICS_CAMPAIGN_STATUSES,
  ANALYTICS_EXPERIMENT_STATUSES,
} from '@zenith/shared';

const eventTypeEnum = z.enum([
  'page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify',
]);
const deviceTypeEnum = z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']);
const metaStatusEnum = z.enum(['active', 'deprecated', 'blocked']);
const sourceEnum = z.enum(ANALYTICS_EVENT_SOURCES);
const environmentEnum = z.enum(ANALYTICS_ENVIRONMENTS);
const identityTypeEnum = z.enum(ANALYTICS_IDENTITY_TYPES);
const overrideStatusEnum = z.enum(['enabled', 'disabled']);
const qualityIssueTypeEnum = z.enum(ANALYTICS_QUALITY_ISSUE_TYPES);
const segmentCompareOpEnum = z.enum(ANALYTICS_SEGMENT_COMPARE_OPS);
const eventQueryGroupByEnum = z.enum(ANALYTICS_EVENT_QUERY_GROUP_BY_FIELDS);
const eventQueryMetricEnum = z.enum(ANALYTICS_EVENT_QUERY_METRICS);
const retentionModeEnum = z.enum(ANALYTICS_RETENTION_MODES);
const campaignChannelEnum = z.enum(ANALYTICS_CAMPAIGN_CHANNELS);
const campaignStatusEnum = z.enum(ANALYTICS_CAMPAIGN_STATUSES);
const experimentStatusEnum = z.enum(ANALYTICS_EXPERIMENT_STATUSES);

// 分群 / 漏斗 / 事件查询共用的属性过滤条件（key + 比较运算符 + 值）
const analyticsSegmentPropertyFilterDTO = z.object({
  key: z.string().min(1).max(64),
  op: segmentCompareOpEnum,
  value: z.unknown(),
});

// ─── 埋点上报 ─────────────────────────────────────────────────────────────────
function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const stack: Array<{ value: object; depth: number }> = [{ value, depth: 1 }];
  const seen = new WeakSet<object>();
  let maxDepth = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    maxDepth = Math.max(maxDepth, current.depth);
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) {
      if (child !== null && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return maxDepth;
}

const eventPropertiesDTO = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (Object.keys(value).length > 50) ctx.addIssue({ code: 'custom', message: '事件属性最多允许 50 个字段' });
  if (jsonDepth(value) > 6) ctx.addIssue({ code: 'custom', message: '事件属性嵌套层级不能超过 6 层' });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > ANALYTICS_PROPERTIES_MAX_BYTES) {
    ctx.addIssue({ code: 'custom', message: `事件属性序列化后不能超过 ${ANALYTICS_PROPERTIES_MAX_BYTES} 字节` });
  }
});

const userEventBaseDTO = z.object({
    eventId: z.uuid().optional(),
    sessionId: z.string().min(1).max(36),
    anonymousId: z.string().min(1).max(64).optional(),
    distinctId: z.string().min(1).max(64).optional(),
    eventName: z.string().max(128).optional(),
    pagePath: z.string().min(1).max(256),
    pageTitle: z.string().max(128).optional(),
    elementKey: z.string().max(128).optional(),
    elementLabel: z.string().max(128).optional(),
    componentArea: z.string().max(64).optional(),
    clickX: z.number().min(0).max(100).optional(),
    clickY: z.number().min(0).max(100).optional(),
    scrollDepth: z.number().int().min(0).max(100).optional(),
    durationMs: z.number().int().min(0).optional(),
    properties: eventPropertiesDTO.optional(),
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
    // 行为中心阶段 1：多端平台字段（均可选，未携带时由服务端按接入方式默认推断）
    source: sourceEnum.optional(),
    appId: z.string().min(1).max(64).optional(),
    environment: environmentEnum.optional(),
    sdkVersion: z.string().max(32).optional(),
  });

export const UserEventInputDTO = z
  .discriminatedUnion('eventType', [
    userEventBaseDTO.extend({ eventType: z.literal('page_view') }),
    userEventBaseDTO.extend({ eventType: z.literal('page_leave') }),
    userEventBaseDTO.extend({ eventType: z.literal('feature_use') }),
    userEventBaseDTO.extend({ eventType: z.literal('area_click') }),
    userEventBaseDTO.extend({ eventType: z.literal('api_request') }),
    userEventBaseDTO.extend({ eventType: z.literal('custom'), eventName: z.string().min(1).max(128) }),
    userEventBaseDTO.extend({ eventType: z.literal('perf'), metricName: z.string().min(1).max(32), metricValue: z.number() }),
    userEventBaseDTO.extend({ eventType: z.literal('identify'), distinctId: z.string().min(1).max(64) }),
  ])
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
    sessionTimeoutMinutes: z.number().int(),
    siteId: z.number().int().optional(),
    appId: z.string().optional(),
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
    memberId: z.number().int().nullable(),
    source: sourceEnum,
    appId: z.string(),
    environment: environmentEnum,
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
        averageConversionMs: z.number().nullable(),
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
    mode: retentionModeEnum,
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
    memberId: z.number().int().nullable(),
    source: sourceEnum,
    appId: z.string(),
    environment: environmentEnum,
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
    memberId: z.number().int().nullable(),
    source: sourceEnum,
    appId: z.string(),
    environment: environmentEnum,
    sdkVersion: z.string().nullable(),
  })
  .openapi('EventDetail');

// ─── 事件元数据（Tracking Plan）────────────────────────────────────────────────
const analyticsEventPropertyDefDTO = z.object({
  key: z.string().min(1).max(64),
  type: z.enum(ANALYTICS_EVENT_PROPERTY_TYPES),
  description: z.string().max(256).optional(),
  required: z.boolean().optional(),
  enumValues: z.array(z.string().max(128)).max(50).optional(),
  pii: z.boolean().optional(),
});
const analyticsEventPropertySchemaDTO = z.array(analyticsEventPropertyDefDTO).max(100).superRefine((defs, ctx) => {
  const seen = new Set<string>();
  defs.forEach((def, index) => {
    if (seen.has(def.key)) {
      ctx.addIssue({ code: 'custom', path: [index, 'key'], message: `属性 key「${def.key}」重复，同一事件的属性 schema 中 key 必须唯一` });
    }
    seen.add(def.key);
  });
});

export const AnalyticsEventMetaDTO = z
  .object({
    id: z.number().int(),
    eventName: z.string(),
    displayName: z.string().nullable(),
    category: z.string().nullable(),
    description: z.string().nullable(),
    propertySchema: analyticsEventPropertySchemaDTO.nullable(),
    status: metaStatusEnum,
    version: z.number().int(),
    ownerId: z.number().int().nullable(),
    ownerName: z.string().nullable(),
    strictMode: z.boolean(),
    eventCount: z.number().int(),
    firstSeenAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsEventMeta');

const analyticsEventMetaInputDTO = z.object({
    eventName: z.string().min(1).max(128),
    displayName: z.string().max(128).nullable().optional(),
    category: z.string().max(64).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    propertySchema: analyticsEventPropertySchemaDTO.nullable().optional(),
    status: metaStatusEnum.default('active'),
    ownerId: z.number().int().nullable().optional(),
    ownerName: z.string().max(64).nullable().optional(),
    strictMode: z.boolean().default(false),
  });

export const CreateAnalyticsEventMetaDTO = analyticsEventMetaInputDTO
  .openapi('CreateAnalyticsEventMeta');
export const UpdateAnalyticsEventMetaDTO = analyticsEventMetaInputDTO.partial().openapi('UpdateAnalyticsEventMeta');


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
          properties: z.array(analyticsSegmentPropertyFilterDTO).max(5).optional(),
        }),
      )
      .min(2)
      .max(10),
    conversionWindowHours: z.number().int().min(1).max(720).default(72),
    segmentId: z.number().int().positive().optional(),
  })
  .openapi('FunnelQueryBody');

// ─── 通用事件分析工作台查询体 ─────────────────────────────────────────────────
export const AnalyticsEventQueryBodyDTO = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    days: z.number().int().min(1).max(365).default(30),
    eventNames: z.array(z.string().min(1).max(128)).max(20).optional(),
    source: sourceEnum.optional(),
    appId: z.string().max(64).optional(),
    environment: environmentEnum.optional(),
    deviceType: deviceTypeEnum.optional(),
    propertyFilters: z.array(analyticsSegmentPropertyFilterDTO).max(10).optional(),
    segmentId: z.number().int().positive().optional(),
    groupBy: z.array(eventQueryGroupByEnum).min(1).max(2).default(['date']),
    metric: eventQueryMetricEnum.default('events'),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .openapi('AnalyticsEventQueryBody');

export const AnalyticsEventQueryResultDTO = z
  .object({
    rows: z.array(z.object({ dimensions: z.record(z.string(), z.string()), value: z.number() })),
    total: z.number().int(),
    queryMeta: z.object({
      metric: eventQueryMetricEnum,
      groupBy: z.array(eventQueryGroupByEnum),
      startDate: z.string(),
      endDate: z.string(),
    }),
  })
  .openapi('AnalyticsEventQueryResult');

// ─── 事件覆盖（租户级启停）────────────────────────────────────────────────────
export const AnalyticsEventOverrideDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int(),
    eventName: z.string(),
    status: overrideStatusEnum,
    reason: z.string().nullable(),
    createdBy: z.number().int().nullable(),
    updatedBy: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsEventOverride');

export const CreateAnalyticsEventOverrideDTO = z
  .object({
    eventName: z.string().min(1).max(128),
    status: overrideStatusEnum,
    reason: z.string().max(256).nullable().optional(),
  })
  .openapi('CreateAnalyticsEventOverride');
export const UpdateAnalyticsEventOverrideDTO = z
  .object({
    status: overrideStatusEnum.optional(),
    reason: z.string().max(256).nullable().optional(),
  })
  .openapi('UpdateAnalyticsEventOverride');


// ─── 站点模型（site key）──────────────────────────────────────────────────────
export const AnalyticsSiteDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int().nullable(),
    tenantName: z.string().nullable().optional(),
    siteKey: z.string(),
    name: z.string(),
    appId: z.string(),
    allowedOrigins: z.array(z.string()).nullable(),
    dailyEventQuota: z.number().int().nullable(),
    todayUsage: z.number().int().nullable(),
    status: overrideStatusEnum,
    remark: z.string().nullable(),
    createdBy: z.number().int().nullable(),
    updatedBy: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsSite');

const analyticsOriginDTO = z.string().min(1).max(255).refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value && url.pathname === '/' && url.search === '' && url.hash === '';
  } catch { return false; }
}, '来源必须是合法 origin');

export const CreateAnalyticsSiteDTO = z
  .object({
    name: z.string().min(1).max(100),
    appId: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/),
    allowedOrigins: z.array(analyticsOriginDTO).max(100).nullable().optional(),
    dailyEventQuota: z.number().int().positive().nullable().optional(),
    status: overrideStatusEnum.default('enabled'),
    remark: z.string().max(500).nullable().optional(),
  })
  .openapi('CreateAnalyticsSite');
export const UpdateAnalyticsSiteDTO = CreateAnalyticsSiteDTO.partial().openapi('UpdateAnalyticsSite');

// ─── 质量日聚合 ───────────────────────────────────────────────────────────────
export const AnalyticsQualityDailyDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int(),
    statDate: z.string(),
    eventName: z.string(),
    issueType: qualityIssueTypeEnum,
    count: z.number().int(),
    sample: z.record(z.string(), z.unknown()).nullable(),
    lastSeenAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsQualityDaily');

// ─── 用户画像（系统派生）──────────────────────────────────────────────────────
export const AnalyticsUserProfileDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int().nullable(),
    distinctId: z.string(),
    identityType: identityTypeEnum,
    userId: z.number().int().nullable(),
    memberId: z.number().int().nullable(),
    displayName: z.string().nullable(),
    properties: z.record(z.string(), z.unknown()).nullable(),
    firstSeenAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsUserProfile');

// ─── 分群规则 ─────────────────────────────────────────────────────────────────
const analyticsSegmentEventConditionDTO = z.object({
  type: z.literal('event'),
  eventName: z.string().min(1).max(128),
  days: z.number().int().min(1).max(365),
  minCount: z.number().int().min(1).max(100_000).optional(),
  properties: z.array(analyticsSegmentPropertyFilterDTO).max(10).optional(),
});

const analyticsSegmentAttributeConditionDTO = z.object({
  type: z.literal('attribute'),
  field: z.string().min(1).max(64),
  op: segmentCompareOpEnum,
  value: z.unknown(),
});

export const AnalyticsSegmentConditionDTO = z.discriminatedUnion('type', [
  analyticsSegmentEventConditionDTO,
  analyticsSegmentAttributeConditionDTO,
]);

export const AnalyticsSegmentRuleDTO = z
  .object({
    operator: z.enum(['AND', 'OR']),
    conditions: z.array(AnalyticsSegmentConditionDTO).min(1).max(10),
  })
  .openapi('AnalyticsSegmentRule');

export const AnalyticsUserSegmentDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    rules: AnalyticsSegmentRuleDTO,
    status: overrideStatusEnum,
    estimatedSize: z.number().int(),
    snapshotAt: z.string().nullable(),
    createdBy: z.number().int().nullable(),
    updatedBy: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsUserSegment');

export const CreateAnalyticsUserSegmentDTO = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().max(500).nullable().optional(),
    rules: AnalyticsSegmentRuleDTO,
    status: overrideStatusEnum.default('enabled'),
  })
  .openapi('CreateAnalyticsUserSegment');
export const UpdateAnalyticsUserSegmentDTO = CreateAnalyticsUserSegmentDTO.partial().openapi('UpdateAnalyticsUserSegment');

export const AnalyticsSegmentMemberDTO = z
  .object({
    id: z.number().int(),
    segmentId: z.number().int(),
    tenantId: z.number().int().nullable(),
    distinctId: z.string(),
    identityType: identityTypeEnum,
    userId: z.number().int().nullable(),
    memberId: z.number().int().nullable(),
    snapshotAt: z.string(),
  })
  .openapi('AnalyticsSegmentMember');

export const AnalyticsCampaignDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int().nullable(),
    segmentId: z.number().int(),
    segmentName: z.string().nullable(),
    name: z.string(),
    channel: campaignChannelEnum,
    templateId: z.number().int().nullable(),
    webhookUrl: z.string().nullable(),
    status: campaignStatusEnum,
    totalCount: z.number().int(),
    sentCount: z.number().int(),
    failedCount: z.number().int(),
    lastRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
    createdBy: z.number().int().nullable(),
    updatedBy: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsCampaign');

const campaignWebhookUrlDTO = z.string().max(500).url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Webhook URL 必须以 http:// 或 https:// 开头');

function refineCampaignDTO(
  value: { channel?: z.infer<typeof campaignChannelEnum>; templateId?: number | null; webhookUrl?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.channel === 'webhook') {
    if (!value.webhookUrl) ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'Webhook 渠道必须填写 Webhook URL' });
  } else if ((value.channel === 'email' || value.channel === 'in_app') && !value.templateId) {
    ctx.addIssue({ code: 'custom', path: ['templateId'], message: '邮件/站内信渠道必须选择模板' });
  }
}

const createAnalyticsCampaignBaseDTO = z
  .object({
    segmentId: z.number().int().positive(),
    name: z.string().min(1).max(100),
    channel: campaignChannelEnum,
    templateId: z.number().int().positive().nullable().optional(),
    webhookUrl: z.preprocess((value) => value === '' ? null : value, campaignWebhookUrlDTO.nullable().optional()),
  });

export const CreateAnalyticsCampaignDTO = createAnalyticsCampaignBaseDTO
  .superRefine(refineCampaignDTO)
  .openapi('CreateAnalyticsCampaign');

export const UpdateAnalyticsCampaignDTO = createAnalyticsCampaignBaseDTO.omit({ segmentId: true }).partial().superRefine(refineCampaignDTO).openapi('UpdateAnalyticsCampaign');


// ─── A/B 实验 ─────────────────────────────────────────────────────────────────
const experimentKeyDTO = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);

export const AnalyticsExperimentVariantDTO = z
  .object({ key: experimentKeyDTO, name: z.string().min(1).max(100), weight: z.number().int().min(0).max(100) })
  .openapi('AnalyticsExperimentVariant');

function refineExperimentVariantsDTO(variants: z.infer<typeof AnalyticsExperimentVariantDTO>[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  const total = variants.reduce((sum, variant, index) => {
    if (seen.has(variant.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: '变体 key 不能重复' });
    seen.add(variant.key);
    return sum + variant.weight;
  }, 0);
  if (total !== 100) ctx.addIssue({ code: 'custom', path: ['weight'], message: '变体权重总和必须等于 100' });
}

const ExperimentVariantsDTO = z.array(AnalyticsExperimentVariantDTO).min(2).max(6).superRefine(refineExperimentVariantsDTO);

function refineExperimentWindowDTO(value: { startAt?: string | null; endAt?: string | null }, ctx: z.RefinementCtx) {
  if (value.startAt && value.endAt && value.endAt <= value.startAt) {
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: '结束时间必须晚于开始时间' });
  }
}

export const AnalyticsExperimentDTO = z
  .object({
    id: z.number().int(),
    tenantId: z.number().int().nullable(),
    tenantName: z.string().nullable().optional(),
    expKey: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: experimentStatusEnum,
    trafficAllocation: z.number().int(),
    variants: z.array(AnalyticsExperimentVariantDTO),
    metricEventName: z.string(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    createdBy: z.number().int().nullable(),
    updatedBy: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AnalyticsExperiment');

const AnalyticsExperimentBaseDTO = z.object({
  expKey: experimentKeyDTO,
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  status: experimentStatusEnum.default('draft'),
  trafficAllocation: z.number().int().min(0).max(100).default(100),
  variants: ExperimentVariantsDTO,
  metricEventName: z.string().min(1).max(128),
  startAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).nullable().optional(),
  endAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).nullable().optional(),
});

export const CreateAnalyticsExperimentDTO = AnalyticsExperimentBaseDTO.superRefine(refineExperimentWindowDTO).openapi('CreateAnalyticsExperiment');
export const UpdateAnalyticsExperimentDTO = AnalyticsExperimentBaseDTO.partial().superRefine(refineExperimentWindowDTO).openapi('UpdateAnalyticsExperiment');

export const AnalyticsExperimentAssignmentDTO = z
  .object({ expKey: z.string(), variantKey: z.string() })
  .openapi('AnalyticsExperimentAssignment');

export const AnalyticsExperimentReportDTO = z
  .object({
    experimentId: z.number().int(),
    expKey: z.string(),
    metricEventName: z.string(),
    variants: z.array(z.object({
      variantKey: z.string(),
      exposures: z.number().int(),
      conversions: z.number().int(),
      conversionRate: z.number(),
    })),
  })
  .openapi('AnalyticsExperimentReport');

// ─── 埋点质量看板查询 ─────────────────────────────────────────────────────────
export const AnalyticsQualityQueryResultDTO = z
  .object({
    items: z.array(AnalyticsQualityDailyDTO),
    totals: z.array(z.object({ issueType: qualityIssueTypeEnum, count: z.number().int() })),
    totalCount: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('AnalyticsQualityQueryResult');

// ─── 事件调试流 ───────────────────────────────────────────────────────────────
export const AnalyticsDebugEventDTO = z
  .object({
    id: z.number().int(),
    eventId: z.string().nullable(),
    eventType: eventTypeEnum,
    eventName: z.string().nullable(),
    source: sourceEnum,
    appId: z.string(),
    environment: environmentEnum,
    distinctId: z.string().nullable(),
    memberId: z.number().int().nullable(),
    userId: z.number().int().nullable(),
    pagePath: z.string(),
    properties: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    issueTypes: z.array(qualityIssueTypeEnum),
  })
  .openapi('AnalyticsDebugEvent');
