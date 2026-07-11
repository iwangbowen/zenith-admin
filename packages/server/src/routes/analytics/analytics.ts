import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { ANALYTICS_QUALITY_ISSUE_TYPES, ANALYTICS_SITE_KEY_HEADER } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { guard } from '../../middleware/guard';
import { namedRateLimit } from '../../middleware/rate-limit';
import {
  validationHook, commonErrorResponses, ok, okMsg, okBody, okPaginated,
  IdParam, PaginationQuery,
} from '../../lib/openapi-schemas';
import {
  BatchUserEventsBodyDTO, AnalyticsPublicConfigDTO, AnalyticsOverviewDTO, TrendSeriesDTO,
  PageStatsDTO, FeatureStatsDTO, HeatmapDataDTO, HeatmapPageListDTO, UserStatsDTO,
  SessionListItemDTO, FunnelResultDTO, FunnelQueryBodyDTO, RetentionResultDTO, PathResultDTO,
  UserTimelineDTO, DimensionBreakdownDTO, DimensionCrossDTO, PerfStatsDTO, RealtimeStatsDTO,
  EventListItemDTO, EventDetailDTO, AnalyticsEventMetaDTO, CreateAnalyticsEventMetaDTO,
  UpdateAnalyticsEventMetaDTO, AnalyticsSettingsDTO, UpdateAnalyticsSettingsDTO, AnalyticsRollupSummaryDTO,
  SessionTimelineDTO, AnalyticsSavedReportDTO, CreateAnalyticsSavedReportDTO,
  AnalyticsEventOverrideDTO, CreateAnalyticsEventOverrideDTO, UpdateAnalyticsEventOverrideDTO,
  AnalyticsQualityQueryResultDTO, AnalyticsDebugEventDTO,
  AnalyticsEventQueryBodyDTO, AnalyticsEventQueryResultDTO,
  AnalyticsUserSegmentDTO, CreateAnalyticsUserSegmentDTO, UpdateAnalyticsUserSegmentDTO, AnalyticsSegmentMemberDTO,
} from '../../lib/openapi-dtos';
import { getClientIp } from '../../lib/request-helpers';
import { parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import {
  batchInsertEvents, getOverview, getTrends, getPageStats, getFeatureStats, getHeatmapData,
  getHeatmapPageList, getUserStats, listSessions, getPathAnalysis,
  getUserTimeline, getDimensionBreakdown, getDimensionCross, getPerfStats, getRealtime, listAnalyticsEvents,
  getEventDetail, cleanAnalyticsEvents, getSessionTimeline,
} from '../../services/analytics/analytics.service';
import { getFunnel, getRetention } from '../../services/analytics/analytics-conversion.service';
import { queryEvents } from '../../services/analytics/analytics-event-query.service';
import {
  listSegments, getSegmentDetail, ensureSegmentExists, createSegment, updateSegment, deleteSegment, listSegmentMembers,
} from '../../services/analytics/analytics-segments.service';
import { getPublicConfig, getSettings, updateSettings } from '../../services/analytics/analytics-settings.service';
import { listEventMeta, createEventMeta, updateEventMeta, deleteEventMeta } from '../../services/analytics/analytics-event-meta.service';
import { getRollupSummary } from '../../services/analytics/analytics-rollup.service';
import { listSavedReports, createSavedReport, deleteSavedReport } from '../../services/analytics/analytics-reports.service';
import {
  listEventOverrides, createEventOverride, updateEventOverride, deleteEventOverride,
} from '../../services/analytics/analytics-event-overrides.service';
import { queryQuality, listDebugEvents } from '../../services/analytics/analytics-quality.service';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { AsyncTaskDTO } from '../../lib/openapi-dtos';
import { getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { formatDate } from '../../lib/datetime';
import { ANALYTICS_ROLLUP_REBUILD_TASK_TYPE, ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE } from '../../services/analytics/analytics-tasks';

const r = new OpenAPIHono({ defaultHook: validationHook });

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30) });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeQuery = daysQuery.extend({ startDate: dateStr.optional(), endDate: dateStr.optional() });

// ─── 采集 ─────────────────────────────────────────────────────────────────────
const ingestRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/events', tags: ['Analytics'], summary: '批量上报用户行为事件（匿名/登录均可）',
    middleware: [optionalAuthMiddleware, namedRateLimit('analytics-ingest')] as const,
    request: { body: { content: { 'application/json': { schema: BatchUserEventsBodyDTO } }, required: true } },
    responses: { ...okMsg('上报成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { events } = c.req.valid('json');
    await batchInsertEvents(events, {
      ip: getClientIp(c),
      ua: c.req.header('user-agent') ?? '',
      siteKey: c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? c.req.query('siteKey') ?? null,
      origin: c.req.header('origin') ?? null,
    });
    return c.json(okBody(null, '上报成功'), 200);
  },
});

const configRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/config', tags: ['Analytics'], summary: 'SDK 公开采集配置',
    middleware: [optionalAuthMiddleware] as const,
    responses: { ...ok(AnalyticsPublicConfigDTO, '采集配置'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPublicConfig(c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? c.req.query('siteKey') ?? null)), 200),
});

// ─── 概览 / 趋势 / 实时 ───────────────────────────────────────────────────────
const overviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/overview', tags: ['Analytics'], summary: '概览 KPI', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const, request: { query: rangeQuery },
    responses: { ...ok(AnalyticsOverviewDTO, '概览'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getOverview(c.req.valid('query'))), 200),
});

const trendsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/trends', tags: ['Analytics'], summary: 'PV/UV/会话/事件趋势', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: rangeQuery.extend({ compare: z.enum(['true', 'false']).optional().default('false') }) },
    responses: { ...ok(TrendSeriesDTO, '趋势'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getTrends({ ...q, compare: q.compare === 'true' })), 200);
  },
});

const realtimeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/realtime', tags: ['Analytics'], summary: '实时概况', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const, responses: { ...ok(RealtimeStatsDTO, '实时'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getRealtime()), 200),
});

// ─── 页面/功能/热力图/用户 ────────────────────────────────────────────────────
const pageStatsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/page-stats', tags: ['Analytics'], summary: '页面停留统计', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30), limit: z.coerce.number().int().min(1).max(100).optional().default(20) }) },
    responses: { ...ok(PageStatsDTO, '页面停留'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPageStats(c.req.valid('query'))), 200),
});

const featureStatsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/feature-stats', tags: ['Analytics'], summary: '功能使用统计', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30), limit: z.coerce.number().int().min(1).max(100).optional().default(30), pagePath: z.string().optional() }) },
    responses: { ...ok(FeatureStatsDTO, '功能使用'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getFeatureStats(c.req.valid('query'))), 200),
});

const heatmapRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/heatmap', tags: ['Analytics'], summary: '点击热力图', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ pagePath: z.string().min(1), componentArea: z.string().optional(), days: z.coerce.number().int().min(1).max(365).optional().default(30) }) },
    responses: { ...ok(HeatmapDataDTO, '热力图'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getHeatmapData(c.req.valid('query'))), 200),
});

const heatmapPagesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/heatmap-pages', tags: ['Analytics'], summary: '热力图页面列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const, request: { query: daysQuery },
    responses: { ...ok(HeatmapPageListDTO, '页面列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getHeatmapPageList(c.req.valid('query'))), 200),
});

const userStatsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/user-stats', tags: ['Analytics'], summary: '用户行为统计', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30), limit: z.coerce.number().int().min(1).max(100).optional().default(20) }) },
    responses: { ...ok(UserStatsDTO, '用户统计'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getUserStats(c.req.valid('query'))), 200),
});

// ─── 会话 / 漏斗 / 留存 / 路径 / 时间线 / 维度 / 性能 ──────────────────────────
const sessionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/sessions', tags: ['Analytics'], summary: '会话列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: PaginationQuery.extend({ username: z.string().optional(), deviceType: z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']).or(z.literal('')).optional() }) },
    responses: { ...okPaginated(SessionListItemDTO, '会话列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listSessions(c.req.valid('query'))), 200),
});

const funnelRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/funnel', tags: ['Analytics'], summary: '漏斗分析', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { body: { content: { 'application/json': { schema: FunnelQueryBodyDTO } }, required: true } },
    responses: { ...ok(FunnelResultDTO, '漏斗'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getFunnel(c.req.valid('json'))), 200),
});

const retentionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/retention', tags: ['Analytics'], summary: '留存分析', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: {
      query: z.object({
        days: z.coerce.number().int().min(1).max(60).optional().default(14),
        mode: z.enum(['first_seen', 'window_first']).optional().default('first_seen'),
      }),
    },
    responses: { ...ok(RetentionResultDTO, '留存'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getRetention(c.req.valid('query'))), 200),
});

// ─── 通用事件分析工作台（行为中心阶段 1）──────────────────────────────────────
const eventQueryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/events/query', tags: ['Analytics'], summary: '通用事件分析查询', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { body: { content: { 'application/json': { schema: AnalyticsEventQueryBodyDTO } }, required: true } },
    responses: { ...ok(AnalyticsEventQueryResultDTO, '事件分析结果'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await queryEvents(c.req.valid('json'))), 200),
});

const pathRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/path', tags: ['Analytics'], summary: '路径分析', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30), limit: z.coerce.number().int().min(1).max(30).optional().default(12), startPage: z.string().max(256).optional() }) },
    responses: { ...ok(PathResultDTO, '路径'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPathAnalysis(c.req.valid('query'))), 200),
});

const userTimelineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/user-timeline', tags: ['Analytics'], summary: '用户行为时间线', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ userId: z.coerce.number().int().optional(), username: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional().default(100) }) },
    responses: { ...ok(UserTimelineDTO, '时间线'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getUserTimeline(c.req.valid('query'))), 200),
});

const sessionTimelineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/session-timeline', tags: ['Analytics'], summary: '会话事件时间轴', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ sessionId: z.string().min(1).max(36), limit: z.coerce.number().int().min(1).max(1000).optional().default(300) }) },
    responses: { ...ok(SessionTimelineDTO, '会话时间轴'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getSessionTimeline(q.sessionId, q.limit)), 200);
  },
});

// ─── 保存的分析报表 ───────────────────────────────────────────────────────────
const reportListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/reports', tags: ['Analytics'], summary: '保存的报表列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ type: z.enum(['funnel']).optional().default('funnel') }) },
    responses: { ...ok(z.object({ list: z.array(AnalyticsSavedReportDTO) }), '报表列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody({ list: await listSavedReports(c.req.valid('query').type) }), 200),
});

const reportCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/reports', tags: ['Analytics'], summary: '保存报表配置', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsSavedReportDTO } }, required: true } },
    responses: { ...ok(AnalyticsSavedReportDTO, '保存成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createSavedReport(c.req.valid('json')), '保存成功'), 200),
});

const reportDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/reports/{id}', tags: ['Analytics'], summary: '删除保存的报表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const, request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteSavedReport(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const dimensionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/dimension', tags: ['Analytics'], summary: '维度分布', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ dimension: z.string().default('browser'), days: z.coerce.number().int().min(1).max(365).optional().default(30), limit: z.coerce.number().int().min(1).max(50).optional().default(12) }) },
    responses: { ...ok(DimensionBreakdownDTO, '维度分布'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getDimensionBreakdown(c.req.valid('query'))), 200),
});

const dimensionCrossRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/dimension-cross', tags: ['Analytics'], summary: '双维交叉分布', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: z.object({ dim1: z.string().default('browser'), dim2: z.string().default('os'), days: z.coerce.number().int().min(1).max(365).optional().default(30), limit: z.coerce.number().int().min(1).max(20).optional().default(10) }) },
    responses: { ...ok(DimensionCrossDTO, '交叉分布'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getDimensionCross(c.req.valid('query'))), 200),
});

const perfRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/perf-stats', tags: ['Analytics'], summary: 'Web Vitals 性能统计', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const, request: { query: daysQuery },
    responses: { ...ok(PerfStatsDTO, '性能'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getPerfStats(c.req.valid('query').days)), 200),
});

// ─── 事件数据管理 ─────────────────────────────────────────────────────────────
const eventListQuery = PaginationQuery.extend({
  eventType: z.enum(['page_view', 'page_leave', 'feature_use', 'area_click', 'custom', 'perf', 'api_request', 'identify']).or(z.literal('')).optional(),
  eventName: z.string().optional(),
  username: z.string().optional(),
  pagePath: z.string().optional(),
  deviceType: z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']).or(z.literal('')).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

function parseEventQuery(q: z.infer<typeof eventListQuery>) {
  return {
    ...q,
    eventType: q.eventType || undefined,
    deviceType: q.deviceType || undefined,
    startTime: parseDateRangeStart(q.startTime) ?? undefined,
    endTime: parseDateRangeEnd(q.endTime) ?? undefined,
  };
}

const eventListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/events', tags: ['Analytics'], summary: '埋点事件列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const, request: { query: eventListQuery },
    responses: { ...okPaginated(EventListItemDTO, '事件列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAnalyticsEvents(parseEventQuery(c.req.valid('query')))), 200),
});

const eventDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/events/{id}', tags: ['Analytics'], summary: '事件详情', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const, request: { params: IdParam },
    responses: { ...ok(EventDetailDTO, '事件详情'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const detail = await getEventDetail(c.req.valid('param').id);
    if (!detail) throw new HTTPException(404, { message: '事件不存在' });
    return c.json(okBody(detail), 200);
  },
});

const cleanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/clean', tags: ['Analytics'], summary: '清除埋点数据', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:clean', audit: { module: '行为分析', description: '清除埋点数据' } })] as const, request: { query: z.object({ days: z.coerce.number().int().min(0).default(0) }) },
    responses: { ...okMsg('清除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const deleted = await cleanAnalyticsEvents(c.req.valid('query').days);
    return c.json(okBody(null, `共删除 ${deleted} 条事件数据`), 200);
  },
});

// ─── 事件元数据 ───────────────────────────────────────────────────────────────
const metaListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/event-meta', tags: ['Analytics'], summary: '事件字典列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['active', 'deprecated', 'blocked']).optional(), category: z.string().optional() }) },
    responses: { ...okPaginated(AnalyticsEventMetaDTO, '事件字典'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listEventMeta(c.req.valid('query'))), 200),
});

const metaCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/event-meta', tags: ['Analytics'], summary: '新增事件字典', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsEventMetaDTO } }, required: true } },
    responses: { ...ok(AnalyticsEventMetaDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createEventMeta(c.req.valid('json')), '创建成功'), 200),
});

const metaUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/event-meta/{id}', tags: ['Analytics'], summary: '更新事件字典', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateAnalyticsEventMetaDTO } }, required: true } },
    responses: { ...ok(AnalyticsEventMetaDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateEventMeta(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const metaDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/event-meta/{id}', tags: ['Analytics'], summary: '删除事件字典', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const, request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteEventMeta(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 租户级事件启停覆盖 ───────────────────────────────────────────────────────
const overrideListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/event-overrides', tags: ['Analytics'], summary: '事件覆盖列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { query: PaginationQuery.extend({ eventName: z.string().optional(), status: z.enum(['enabled', 'disabled']).optional() }) },
    responses: { ...okPaginated(AnalyticsEventOverrideDTO, '事件覆盖列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listEventOverrides(c.req.valid('query'))), 200),
});

const overrideCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/event-overrides', tags: ['Analytics'], summary: '新增事件覆盖', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '新增事件覆盖' } })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsEventOverrideDTO } }, required: true } },
    responses: { ...ok(AnalyticsEventOverrideDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createEventOverride(c.req.valid('json')), '创建成功'), 200),
});

const overrideUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/event-overrides/{id}', tags: ['Analytics'], summary: '更新事件覆盖', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '更新事件覆盖' } })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateAnalyticsEventOverrideDTO } }, required: true } },
    responses: { ...ok(AnalyticsEventOverrideDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateEventOverride(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const overrideDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/event-overrides/{id}', tags: ['Analytics'], summary: '删除事件覆盖', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '删除事件覆盖' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteEventOverride(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 埋点质量看板 ─────────────────────────────────────────────────────────────
const qualityRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/quality', tags: ['Analytics'], summary: '埋点质量看板', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: {
      query: PaginationQuery.extend({
        days: z.coerce.number().int().min(1).max(90).optional(),
        eventName: z.string().optional(),
        issueType: z.enum(ANALYTICS_QUALITY_ISSUE_TYPES).optional(),
      }),
    },
    responses: { ...ok(AnalyticsQualityQueryResultDTO, '质量看板数据'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await queryQuality(c.req.valid('query'))), 200),
});

// ─── 事件调试流 ───────────────────────────────────────────────────────────────
const debugEventsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/debug/events', tags: ['Analytics'], summary: '实时事件调试流', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional().default(50), eventName: z.string().optional() }) },
    responses: { ...ok(z.array(AnalyticsDebugEventDTO), '最近事件摘要'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listDebugEvents(c.req.valid('query'))), 200),
});

// ─── 采集设置 ─────────────────────────────────────────────────────────────────
const settingsGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/settings', tags: ['Analytics'], summary: '获取采集设置', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const, responses: { ...ok(AnalyticsSettingsDTO, '采集设置'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getSettings()), 200),
});

const settingsUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/settings', tags: ['Analytics'], summary: '更新采集设置', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { body: { content: { 'application/json': { schema: UpdateAnalyticsSettingsDTO } }, required: true } },
    responses: { ...ok(AnalyticsSettingsDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateSettings(c.req.valid('json')), '更新成功'), 200),
});

// ─── 数据聚合 ─────────────────────────────────────────────────────────────────
const rollupGetRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/rollup', tags: ['Analytics'], summary: '每日聚合数据', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const, request: { query: z.object({ days: z.coerce.number().int().min(1).max(730).optional().default(30) }) },
    responses: { ...ok(AnalyticsRollupSummaryDTO, '聚合数据'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody({ items: await getRollupSummary(c.req.valid('query').days) }), 200),
});

const rollupRebuildRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/rollup/rebuild', tags: ['Analytics'], summary: '重建每日聚合', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '提交重建每日聚合任务' } })] as const,
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(730).optional().default(30) }) },
    responses: { ...ok(AsyncTaskDTO, '任务已提交'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const user = currentUser();
    const tenantId = getCreateTenantId(user);
    const idempotencyKey = `${ANALYTICS_ROLLUP_REBUILD_TASK_TYPE}:${tenantId ?? 0}:${user.userId}:${days}:${formatDate(new Date())}`;
    const row = await submitAsyncTask({
      taskType: ANALYTICS_ROLLUP_REBUILD_TASK_TYPE,
      title: `重建近 ${days} 天聚合`,
      payload: { days },
      idempotencyKey,
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

// ─── 用户分群 CRUD + 成员物化（行为中心阶段 1）────────────────────────────────
const segmentListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/segments', tags: ['Analytics'], summary: '用户分群列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['enabled', 'disabled']).optional() }) },
    responses: { ...okPaginated(AnalyticsUserSegmentDTO, '分群列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listSegments(c.req.valid('query'))), 200),
});

const segmentCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/segments', tags: ['Analytics'], summary: '创建用户分群', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '创建用户分群' } })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsUserSegmentDTO } }, required: true } },
    responses: { ...ok(AnalyticsUserSegmentDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createSegment(c.req.valid('json')), '创建成功'), 200),
});

const segmentDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/segments/{id}', tags: ['Analytics'], summary: '分群详情', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { params: IdParam },
    responses: { ...ok(AnalyticsUserSegmentDTO, '分群详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getSegmentDetail(c.req.valid('param').id)), 200),
});

const segmentUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/segments/{id}', tags: ['Analytics'], summary: '更新分群', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '更新用户分群' } })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateAnalyticsUserSegmentDTO } }, required: true } },
    responses: { ...ok(AnalyticsUserSegmentDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateSegment(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const segmentDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/segments/{id}', tags: ['Analytics'], summary: '删除分群', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '删除用户分群' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteSegment(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const segmentMembersRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/segments/{id}/members', tags: ['Analytics'], summary: '分群成员分页', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { params: IdParam, query: PaginationQuery },
    responses: { ...okPaginated(AnalyticsSegmentMemberDTO, '分群成员'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listSegmentMembers(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const segmentMaterializeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/segments/{id}/materialize', tags: ['Analytics'], summary: '重算分群成员（异步任务）', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '提交分群重算任务' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(AsyncTaskDTO, '任务已提交'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const segment = await ensureSegmentExists(id); // 校验 tenant，并用规则版本打破旧任务幂等键
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = `${ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE}:${id}:${segment.updatedAt.getTime()}:${minuteBucket}`;
    const row = await submitAsyncTask({
      taskType: ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE,
      title: `重算分群 #${id} 成员`,
      payload: { segmentId: id },
      idempotencyKey,
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

r.openapiRoutes([
  ingestRoute, configRoute,
  overviewRoute, trendsRoute, realtimeRoute,
  pageStatsRoute, featureStatsRoute, heatmapRoute, heatmapPagesRoute, userStatsRoute,
  sessionsRoute, funnelRoute, retentionRoute, eventQueryRoute, pathRoute, userTimelineRoute, sessionTimelineRoute, dimensionRoute, dimensionCrossRoute, perfRoute,
  reportListRoute, reportCreateRoute, reportDeleteRoute,
  eventListRoute, eventDetailRoute, cleanRoute,
  metaListRoute, metaCreateRoute, metaUpdateRoute, metaDeleteRoute,
  overrideListRoute, overrideCreateRoute, overrideUpdateRoute, overrideDeleteRoute,
  qualityRoute, debugEventsRoute,
  settingsGetRoute, settingsUpdateRoute,
  rollupGetRoute, rollupRebuildRoute,
] as const);

r.openapiRoutes([
  segmentListRoute, segmentCreateRoute, segmentDetailRoute, segmentUpdateRoute, segmentDeleteRoute,
  segmentMembersRoute, segmentMaterializeRoute,
] as const);

export default r;
