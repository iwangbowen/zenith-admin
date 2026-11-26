import * as z from 'zod';
import { dateRangeQuery, idParam, keywordQuery, paginated, paginationQuery, queryBool, queryEnum, idQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { userBehaviorEventTypeEnum } from '../validation';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import {
  ANALYTICS_ACQUISITION_DIMENSIONS,
  ANALYTICS_ATTRIBUTION_MODELS,
  ANALYTICS_DEVICE_TYPES,
  ANALYTICS_EVENT_META_STATUSES,
  ANALYTICS_EVENT_OVERRIDE_STATUSES,
  ANALYTICS_EVENT_SOURCES,
  ANALYTICS_QUALITY_ISSUE_TYPES,
  ANALYTICS_SAVED_REPORT_TYPES,
} from '../constants';
import {
  analyticsDrillUsersSchema,
  analyticsEventQuerySchema,
  batchTrackEventsSchema,
  createAnalyticsEventMetaSchema,
  createAnalyticsEventOverrideSchema,
  createAnalyticsSavedReportSchema,
  createAnalyticsUserSegmentSchema,
  funnelQuerySchema,
  retentionQuerySchema,
  updateAnalyticsEventMetaSchema,
  updateAnalyticsEventOverrideSchema,
  updateAnalyticsUserSegmentSchema,
} from '../validation';
import { dateOnly, daysQuery, siteKeyQueryField } from './_query';
import {
  analyticsOverviewSchema,
  analyticsUserStatsSchema,
  analyticsUserTimelineSchema,
  featureStatsSchema,
  heatmapDataSchema,
  heatmapPageListSchema,
  pageStatsSchema,
  pathResultSchema,
  perfStatsSchema,
  realtimeStatsSchema,
  sessionListItemSchema,
  sessionTimelineSchema,
  trendSeriesSchema,
} from './analytics-behavior';
import {
  analyticsAcquisitionResultSchema,
  analyticsDrillUsersResultSchema,
  analyticsEventQueryResultSchema,
  analyticsSavedReportListSchema,
  analyticsSavedReportSchema,
  funnelResultSchema,
  retentionResultSchema,
} from './analytics-conversion';
import {
  analyticsDebugEventSchema,
  analyticsEventMetaReferencesSchema,
  analyticsEventMetaSchema,
  analyticsEventOverrideSchema,
  analyticsPublicConfigSchema,
  analyticsQualityQueryResultSchema,
  analyticsRollupSummarySchema,
  eventDetailSchema,
  eventListItemSchema,
} from './analytics-events';
import { analyticsSegmentMemberSchema, analyticsUserSegmentSchema } from './analytics-segments';

// ─── 查询参数 ────────────────────────────────────────────────────────────────

/** 站点 Key：匿名采集时用于归属租户；也可经 `X-Analytics-Site-Key` 请求头传递 */
export const analyticsSiteKeyQuery = z.object({
  siteKey: siteKeyQueryField,
});

/** 统计区间：优先自定义 startDate / endDate（含端点日），否则最近 days 天 */
export const analyticsRangeQuery = z.object({
  days: daysQuery(365, 30),
  startDate: dateOnly.optional().meta({ description: '区间起始日（YYYY-MM-DD）' }),
  endDate: dateOnly.optional().meta({ description: '区间结束日（YYYY-MM-DD）' }),
});

export const analyticsTrendsQuery = analyticsRangeQuery.extend({
  compare: queryBool('是否附带上一周期对比序列').default(false),
});

export const analyticsDaysQuery = z.object({ days: daysQuery(365, 30) });

export const analyticsPagedDaysQuery = paginationQuery.extend({ days: daysQuery(365, 30) });

export const analyticsFeatureStatsQuery = analyticsPagedDaysQuery.extend({
  pagePath: z.string().optional(),
});

export const analyticsHeatmapQuery = z.object({
  pagePath: z.string().min(1),
  componentArea: z.string().optional().meta({ description: '为空即全页模式' }),
  days: daysQuery(365, 30),
  deviceType: queryEnum(ANALYTICS_DEVICE_TYPES),
  source: queryEnum(ANALYTICS_EVENT_SOURCES),
});

export const analyticsSessionListQuery = paginationQuery.extend({
  username: z.string().optional(),
  deviceType: queryEnum(ANALYTICS_DEVICE_TYPES),
});

export const analyticsAcquisitionQuery = z.object({
  days: daysQuery(365, 30),
  dimension: z.enum(ANALYTICS_ACQUISITION_DIMENSIONS).default('channel'),
  model: z.enum(ANALYTICS_ATTRIBUTION_MODELS).default('last_touch'),
  conversionEvent: z.string().max(128).optional().meta({ description: '转化事件名；留空则只看流量结构，不算转化' }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const analyticsPathQuery = z.object({
  days: daysQuery(365, 30),
  limit: z.coerce.number().int().min(1).max(100).default(30).meta({ description: '保留的跳转边数上限' }),
  startPage: z.string().max(256).optional(),
});

export const analyticsUserTimelineQuery = z.object({
  userId: idQuery(),
  username: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const analyticsSessionTimelineQuery = z.object({
  sessionId: z.string().min(1).max(36),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

export const analyticsSavedReportListQuery = z.object({
  type: z.enum(ANALYTICS_SAVED_REPORT_TYPES).default('funnel'),
});

export const analyticsEventListQuery = paginationQuery.extend({
  eventType: queryEnum(userBehaviorEventTypeEnum.options),
  eventName: z.string().optional(),
  username: z.string().optional(),
  pagePath: z.string().optional(),
  deviceType: queryEnum(ANALYTICS_DEVICE_TYPES),
  ...dateRangeQuery(),
});

export const analyticsCleanQuery = z.object({
  days: z.coerce.number().int().min(0).default(0).meta({ description: '仅清除 N 天前的数据；0 = 全部' }),
});

export const analyticsEventMetaListQuery = paginationQuery.extend({
  keyword: keywordQuery(),
  status: queryEnum(ANALYTICS_EVENT_META_STATUSES),
  category: z.string().optional(),
});

export const analyticsEventMetaReferencesQuery = z.object({
  eventName: z.string().min(1).max(128),
});

export const analyticsEventOverrideListQuery = paginationQuery.extend({
  eventName: z.string().optional(),
  status: queryEnum(ANALYTICS_EVENT_OVERRIDE_STATUSES),
});

export const analyticsQualityQuery = paginationQuery.extend({
  days: z.coerce.number().int().min(1).max(90).optional(),
  eventName: z.string().optional(),
  issueType: queryEnum(ANALYTICS_QUALITY_ISSUE_TYPES),
});

export const analyticsDebugEventsQuery = paginationQuery.extend({
  eventName: z.string().optional(),
});

export const analyticsRollupQuery = z.object({ days: daysQuery(730, 30) });

export const analyticsSegmentListQuery = paginationQuery.extend({
  keyword: keywordQuery(),
  status: queryEnum(ANALYTICS_EVENT_OVERRIDE_STATUSES),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const analyticsContract = defineContract('/api/analytics', {
  // 采集（SDK 侧，匿名 / 登录均可）
  track: op.post('/events', { query: analyticsSiteKeyQuery, body: batchTrackEventsSchema, public: true, summary: '批量上报用户行为事件（匿名/登录均可）' }),
  config: op.get('/config', { query: analyticsSiteKeyQuery, response: analyticsPublicConfigSchema, public: true, summary: 'SDK 公开采集配置' }),

  // 概览 / 趋势 / 实时
  overview: op.get('/overview', { access: { permission: 'analytics:view' }, query: analyticsRangeQuery, response: analyticsOverviewSchema, summary: '概览 KPI' }),
  trends: op.get('/trends', { access: { permission: 'analytics:view' }, query: analyticsTrendsQuery, response: trendSeriesSchema, summary: 'PV/UV/会话/事件趋势' }),
  realtime: op.get('/realtime', { access: { permission: 'analytics:view' }, response: realtimeStatsSchema, summary: '实时概况' }),

  // 页面 / 功能 / 热力图 / 用户
  pageStats: op.get('/page-stats', { access: { permission: 'analytics:view' }, query: analyticsPagedDaysQuery, response: pageStatsSchema, summary: '页面停留统计' }),
  featureStats: op.get('/feature-stats', { access: { permission: 'analytics:view' }, query: analyticsFeatureStatsQuery, response: featureStatsSchema, summary: '功能使用统计' }),
  heatmap: op.get('/heatmap', { access: { permission: 'analytics:view' }, query: analyticsHeatmapQuery, response: heatmapDataSchema, summary: '点击热力图' }),
  heatmapPages: op.get('/heatmap-pages', { access: { permission: 'analytics:view' }, query: analyticsDaysQuery, response: heatmapPageListSchema, summary: '热力图页面列表' }),
  userStats: op.get('/user-stats', { access: { permission: 'analytics:view' }, query: analyticsPagedDaysQuery, response: analyticsUserStatsSchema, summary: '用户行为统计' }),

  // 会话 / 漏斗 / 留存 / 获客 / 下钻 / 事件分析 / 路径 / 时间线 / 性能
  sessions: op.get('/sessions', { access: { permission: 'analytics:view' }, query: analyticsSessionListQuery, response: paginated(sessionListItemSchema), summary: '会话列表' }),
  funnel: op.post('/funnel', { access: { permission: 'analytics:view' }, body: funnelQuerySchema, response: funnelResultSchema, summary: '漏斗分析' }),
  retention: op.post('/retention', {
    access: { permission: 'analytics:view' },
    body: retentionQuerySchema,
    response: retentionResultSchema,
    summary: '留存分析',
    description: '含对比轴（判别联合对象），query string 无法自然承载，故用 POST 传查询体。',
  }),
  acquisition: op.get('/acquisition', { access: { permission: 'analytics:view' }, query: analyticsAcquisitionQuery, response: analyticsAcquisitionResultSchema, summary: '获客渠道与归因报表' }),
  drillUsers: op.post('/drill-users', { access: { permission: 'analytics:view' }, body: analyticsDrillUsersSchema, response: analyticsDrillUsersResultSchema, summary: '图表下钻用户列表' }),
  queryEvents: op.post('/events/query', { access: { permission: 'analytics:view' }, body: analyticsEventQuerySchema, response: analyticsEventQueryResultSchema, summary: '通用事件分析查询' }),
  path: op.get('/path', { access: { permission: 'analytics:view' }, query: analyticsPathQuery, response: pathResultSchema, summary: '路径分析' }),
  userTimeline: op.get('/user-timeline', { access: { permission: 'analytics:view' }, query: analyticsUserTimelineQuery, response: analyticsUserTimelineSchema, summary: '用户行为时间线' }),
  sessionTimeline: op.get('/session-timeline', { access: { permission: 'analytics:view' }, query: analyticsSessionTimelineQuery, response: sessionTimelineSchema, summary: '会话事件时间轴' }),
  perfStats: op.get('/perf-stats', { access: { permission: 'analytics:view' }, query: analyticsDaysQuery, response: perfStatsSchema, summary: 'Web Vitals 性能统计' }),

  // 保存的分析报表
  reports: op.get('/reports', { access: { permission: 'analytics:view' }, query: analyticsSavedReportListQuery, response: analyticsSavedReportListSchema, summary: '保存的报表列表' }),
  createReport: op.post('/reports', { access: { permission: 'analytics:report:manage' }, body: createAnalyticsSavedReportSchema, response: analyticsSavedReportSchema, summary: '保存报表配置' }),
  removeReport: op.delete('/reports/{id}', { access: { permission: 'analytics:report:manage' }, params: idParam, summary: '删除保存的报表' }),

  // 事件数据管理
  events: op.get('/events', { access: { permission: 'analytics:data:view' }, query: analyticsEventListQuery, response: paginated(eventListItemSchema), summary: '埋点事件列表' }),
  eventDetail: op.get('/events/{id}', { access: { permission: 'analytics:data:view' }, params: idParam, response: eventDetailSchema, summary: '事件详情' }),
  clean: op.delete('/clean', { access: { permission: 'analytics:clean' }, audit: '清除埋点数据', query: analyticsCleanQuery, summary: '清除埋点数据' }),

  // 事件字典（Tracking Plan）
  eventMeta: op.get('/event-meta', { access: { permission: 'analytics:data:view' }, query: analyticsEventMetaListQuery, response: paginated(analyticsEventMetaSchema), summary: '事件字典列表' }),
  createEventMeta: op.post('/event-meta', { access: { permission: 'analytics:manage' }, body: createAnalyticsEventMetaSchema, response: analyticsEventMetaSchema, summary: '新增事件字典' }),
  updateEventMeta: op.put('/event-meta/{id}', { access: { permission: 'analytics:manage' }, params: idParam, body: updateAnalyticsEventMetaSchema, response: analyticsEventMetaSchema, summary: '更新事件字典' }),
  removeEventMeta: op.delete('/event-meta/{id}', { access: { permission: 'analytics:manage' }, params: idParam, summary: '删除事件字典' }),
  eventMetaReferences: op.get('/event-meta/references', {
    access: { permission: 'analytics:data:view' },
    query: analyticsEventMetaReferencesQuery,
    response: analyticsEventMetaReferencesSchema,
    summary: '事件字典下游引用（漏斗报表 / 分群 / 实验）',
  }),

  // 租户级事件启停覆盖
  eventOverrides: op.get('/event-overrides', { access: { permission: 'analytics:data:view' }, query: analyticsEventOverrideListQuery, response: paginated(analyticsEventOverrideSchema), summary: '事件覆盖列表' }),
  createEventOverride: op.post('/event-overrides', { access: { permission: 'analytics:manage' }, audit: '新增事件覆盖', body: createAnalyticsEventOverrideSchema, response: analyticsEventOverrideSchema, summary: '新增事件覆盖' }),
  updateEventOverride: op.put('/event-overrides/{id}', { access: { permission: 'analytics:manage' }, audit: '更新事件覆盖', params: idParam, body: updateAnalyticsEventOverrideSchema, response: analyticsEventOverrideSchema, summary: '更新事件覆盖' }),
  removeEventOverride: op.delete('/event-overrides/{id}', { access: { permission: 'analytics:manage' }, audit: '删除事件覆盖', params: idParam, summary: '删除事件覆盖' }),

  // 埋点质量 / 调试
  quality: op.get('/quality', { access: { permission: 'analytics:data:view' }, query: analyticsQualityQuery, response: analyticsQualityQueryResultSchema, summary: '埋点质量看板' }),
  debugEvents: op.get('/debug/events', { access: { permission: 'analytics:data:view' }, query: analyticsDebugEventsQuery, response: paginated(analyticsDebugEventSchema), summary: '事件调试查询' }),

  rollup: op.get('/rollup', { access: { permission: 'analytics:data:view' }, query: analyticsRollupQuery, response: analyticsRollupSummarySchema, summary: '每日聚合数据' }),
  rebuildRollup: op.post('/rollup/rebuild', { access: { permission: 'analytics:manage' }, audit: '提交重建每日聚合任务', query: analyticsRollupQuery, response: asyncTaskSchema, summary: '重建每日聚合（异步任务）' }),

  // 用户分群 CRUD + 成员物化
  segments: op.get('/segments', { access: { permission: 'analytics:data:view' }, query: analyticsSegmentListQuery, response: paginated(analyticsUserSegmentSchema), summary: '用户分群列表' }),
  createSegment: op.post('/segments', { access: { permission: 'analytics:manage' }, audit: '创建用户分群', body: createAnalyticsUserSegmentSchema, response: analyticsUserSegmentSchema, summary: '创建用户分群' }),
  segmentDetail: op.get('/segments/{id}', { access: { permission: 'analytics:data:view' }, params: idParam, response: analyticsUserSegmentSchema, summary: '分群详情' }),
  updateSegment: op.put('/segments/{id}', { access: { permission: 'analytics:manage' }, audit: '更新用户分群', params: idParam, body: updateAnalyticsUserSegmentSchema, response: analyticsUserSegmentSchema, summary: '更新分群' }),
  removeSegment: op.delete('/segments/{id}', { access: { permission: 'analytics:manage' }, audit: '删除用户分群', params: idParam, summary: '删除分群' }),
  segmentMembers: op.get('/segments/{id}/members', { access: { permission: 'analytics:data:view' }, params: idParam, query: paginationQuery, response: paginated(analyticsSegmentMemberSchema), summary: '分群成员分页' }),
  materializeSegment: op.post('/segments/{id}/materialize', { access: { permission: 'analytics:manage' }, audit: '提交分群重算任务', params: idParam, response: asyncTaskSchema, summary: '重算分群成员（异步任务）' }),
}, { auditModule: '行为分析', tags: ['Analytics'] });
