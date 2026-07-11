import { http, HttpResponse } from 'msw';
import type {
  PageStats, FeatureStats, HeatmapData, HeatmapPageListItem, UserStats, AnalyticsOverview,
  TrendSeries, RealtimeStats, SessionListItem, FunnelResult, RetentionResult, PathResult,
  UserTimeline, DimensionBreakdown, DimensionCross, PerfStats, EventListItem, EventDetail, AnalyticsEventMeta,
  AnalyticsSettings, AnalyticsPublicConfig, PaginatedResponse, AnalyticsRollupItem, UserBehaviorEventType,
  SessionTimeline, AnalyticsSavedReport,
  AnalyticsEventOverride, AnalyticsQualityDaily, AnalyticsQualityIssueType, AnalyticsQualityQueryResult, AnalyticsDebugEvent,
  AnalyticsUserSegment, AnalyticsSegmentMember, AnalyticsSegmentCampaign, AnalyticsSite, AnalyticsExperiment, AnalyticsExperimentAssignment, AnalyticsExperimentReport, AsyncTask,
  AnalyticsEventQueryInput, AnalyticsEventQueryResult, AnalyticsEventQueryRow, AnalyticsEventQueryGroupByField, AnalyticsEventQueryMetric,
} from '@zenith/shared';
import { SEED_ANALYTICS_EVENT_META, SEED_ANALYTICS_SITES, ANALYTICS_SITE_KEY_HEADER, ANALYTICS_QUALITY_ISSUE_TYPES } from '@zenith/shared';
import { mockDateTime, mockDateTimeOffset, mockDateOffset } from '../utils/date';
import { createProgressingMockTask } from './async-tasks';

const ok = <T>(data: T, message = 'ok') => HttpResponse.json({ code: 0, message, data });

function daysAxis(days: number): string[] {
  const arr: string[] = [];
  for (let i = days - 1; i >= 0; i--) arr.push(mockDateOffset(-i));
  return arr;
}
function rand(min: number, max: number): number { return Math.floor(min + Math.random() * (max - min)); }

/** 日期字符串按天偏移（YYYY-MM-DD） */
function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let mockSavedReports: AnalyticsSavedReport[] = [
  { id: 1, name: '注册转化漏斗', reportType: 'funnel', config: { days: 30, steps: [{ label: '进入首页', pagePath: '/' }, { label: '进入用户管理', pagePath: '/users' }, { label: '新增用户', eventName: '$autocapture' }] }, createdBy: 1, createdByName: 'admin', createdAt: mockDateTimeOffset(-5 * 86400000) },
];
let nextReportId = 2;

// ─── 静态基础数据 ─────────────────────────────────────────────────────────────
const MOCK_PAGES: PageStats = {
  totalVisits: 2847,
  avgDwellMs: 58400,
  items: [
    { pagePath: '/users', pageTitle: '用户管理', visits: 532, avgMs: 68400, medianMs: 45200, p90Ms: 142000 },
    { pagePath: '/roles', pageTitle: '角色管理', visits: 384, avgMs: 52100, medianMs: 38700, p90Ms: 118000 },
    { pagePath: '/workflow/definitions', pageTitle: '流程定义', visits: 298, avgMs: 124500, medianMs: 89300, p90Ms: 286000 },
    { pagePath: '/system/dicts', pageTitle: '字典管理', visits: 245, avgMs: 31200, medianMs: 22400, p90Ms: 72000 },
    { pagePath: '/departments', pageTitle: '部门管理', visits: 213, avgMs: 44700, medianMs: 33100, p90Ms: 98000 },
    { pagePath: '/', pageTitle: '首页', visits: 189, avgMs: 28900, medianMs: 19800, p90Ms: 65000 },
    { pagePath: '/system/menus', pageTitle: '菜单管理', visits: 156, avgMs: 87300, medianMs: 61200, p90Ms: 198000 },
    { pagePath: '/system/configs', pageTitle: '系统配置', visits: 134, avgMs: 39200, medianMs: 27600, p90Ms: 84000 },
  ],
};

const MOCK_FEATURES: FeatureStats = {
  totalEvents: 8924,
  items: [
    { pagePath: '/users', elementKey: 'search-btn', elementLabel: '查询', componentArea: 'search-toolbar', count: 1243 },
    { pagePath: '/users', elementKey: 'create-btn', elementLabel: '新增', componentArea: 'search-toolbar', count: 892 },
    { pagePath: '/users', elementKey: 'export-btn', elementLabel: '导出', componentArea: 'search-toolbar', count: 567 },
    { pagePath: '/roles', elementKey: 'search-btn', elementLabel: '查询', componentArea: 'search-toolbar', count: 498 },
    { pagePath: '/users', elementKey: 'edit-btn', elementLabel: '编辑', componentArea: 'table-actions', count: 423 },
    { pagePath: '/users', elementKey: 'reset-btn', elementLabel: '重置', componentArea: 'search-toolbar', count: 387 },
    { pagePath: '/workflow/definitions', elementKey: 'create-btn', elementLabel: '新建流程', componentArea: 'search-toolbar', count: 312 },
    { pagePath: '/roles', elementKey: 'create-btn', elementLabel: '新增', componentArea: 'search-toolbar', count: 287 },
  ],
};

const MOCK_HEATMAP_PAGES: HeatmapPageListItem[] = [
  { pagePath: '/users', pageTitle: '用户管理', areas: ['search-toolbar', 'table'] },
  { pagePath: '/roles', pageTitle: '角色管理', areas: ['search-toolbar', 'table'] },
  { pagePath: '/departments', pageTitle: '部门管理', areas: ['search-toolbar', 'table'] },
];

function buildMockHeatmapData(pagePath: string, area: string): HeatmapData {
  const points: { x: number; y: number; value: number }[] = [];
  const seed = pagePath.length + area.length;
  for (let i = 0; i < 120; i++) {
    const clusterX = [20, 45, 70, 85][(i + seed) % 4];
    const clusterY = [25, 55, 75][(i + seed) % 3];
    const x = clusterX + ((((i * 1237 + seed * 31) % 200) - 100) / 100) * 20;
    const y = clusterY + ((((i * 971 + seed * 17) % 200) - 100) / 100) * 18;
    points.push({ x: Math.max(1, Math.min(99, x)), y: Math.max(1, Math.min(99, y)), value: Math.max(1, Math.floor(20 - i * 0.15)) });
  }
  return { pagePath, componentArea: area, points, total: 1847 };
}

const DEVICES = ['desktop', 'mobile', 'tablet'] as const;
const BROWSERS = ['Chrome', 'Edge', 'Safari', 'Firefox'];
const OSES = ['Windows', 'macOS', 'iOS', 'Android'];
const USERNAMES = ['admin', 'zhangsan', 'lisi', 'wangwu', 'zhaoliu'];

// ─── 事件字典（内存）──────────────────────────────────────────────────────────
// 前 4 条为前端 SDK 内置自动采集事件；其余派生自 @zenith/shared SEED_ANALYTICS_EVENT_META
// （行为中心阶段 1 服务端权威事件：支付 / 工作流 / 会员），与 DB 种子/服务端订阅产出的 eventName 保持一致。
let mockEventMeta: AnalyticsEventMeta[] = [
  { id: 1, eventName: '$pageview', displayName: '页面浏览', category: 'page_view', description: '页面进入自动采集', propertySchema: null, status: 'active', version: 1, ownerId: null, ownerName: null, strictMode: false, eventCount: 18420, firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-30 * 86400000), updatedAt: mockDateTime() },
  { id: 2, eventName: '$autocapture', displayName: '自动点击', category: 'feature_use', description: '元素点击自动采集', propertySchema: null, status: 'active', version: 1, ownerId: null, ownerName: null, strictMode: false, eventCount: 9234, firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-30 * 86400000), updatedAt: mockDateTime() },
  { id: 3, eventName: '$web_vitals', displayName: 'Web Vitals', category: 'perf', description: '性能指标', propertySchema: null, status: 'active', version: 1, ownerId: null, ownerName: null, strictMode: false, eventCount: 5120, firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-30 * 86400000), updatedAt: mockDateTime() },
  { id: 4, eventName: 'order_submit', displayName: '提交订单', category: 'custom', description: '业务自定义事件', propertySchema: [{ key: 'amount', type: 'number', description: '金额' }], status: 'active', version: 1, ownerId: null, ownerName: null, strictMode: false, eventCount: 842, firstSeenAt: mockDateTimeOffset(-20 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-20 * 86400000), updatedAt: mockDateTime() },
  ...SEED_ANALYTICS_EVENT_META.map((meta): AnalyticsEventMeta => ({
    id: meta.id,
    eventName: meta.eventName,
    displayName: meta.displayName,
    category: meta.category,
    description: meta.description,
    propertySchema: meta.propertySchema,
    status: 'active',
    version: 1,
    ownerId: null,
    ownerName: null,
    strictMode: meta.strictMode,
    eventCount: rand(50, 3000),
    firstSeenAt: mockDateTimeOffset(-20 * 86400000),
    lastSeenAt: mockDateTime(),
    createdAt: mockDateTimeOffset(-20 * 86400000),
    updatedAt: mockDateTime(),
  })),
];
let nextMetaId = 5;

let mockSettings: AnalyticsSettings = {
  id: 1, enabled: true, sampleRate: 1, trackPageviews: true, trackClicks: true, trackPerformance: true,
  trackErrors: true, trackApi: true, maskInputs: true, respectDnt: false, anonymizeIp: false, blacklistPaths: ['/login'],
  retentionDays: 180, errorRetentionDays: 90, sessionTimeoutMinutes: 30, createdAt: mockDateTimeOffset(-60 * 86400000), updatedAt: mockDateTime(),
};

const PUBLIC_CONFIG: AnalyticsPublicConfig = {
  enabled: true, sampleRate: 1, trackPageviews: true, trackClicks: true, trackPerformance: true,
  trackErrors: true, trackApi: true, maskInputs: true, respectDnt: false, blacklistPaths: ['/login'],
  sessionTimeoutMinutes: 30,
};

function buildEvents(count: number): EventListItem[] {
  const types: UserBehaviorEventType[] = ['page_view', 'feature_use', 'page_leave', 'area_click', 'custom', 'perf', 'api_request'];
  return Array.from({ length: count }, (_, i) => ({
    id: 10000 - i,
    userId: rand(1, 6),
    username: USERNAMES[i % USERNAMES.length],
    eventType: types[i % types.length],
    eventName: ['$pageview', '$autocapture', '$pageleave', '$areaclick', 'order_submit', '$web_vitals', '$api'][i % 7],
    pagePath: MOCK_PAGES.items[i % MOCK_PAGES.items.length].pagePath,
    pageTitle: MOCK_PAGES.items[i % MOCK_PAGES.items.length].pageTitle,
    elementKey: i % 3 === 0 ? 'search-btn' : null,
    elementLabel: i % 3 === 0 ? '查询' : null,
    componentArea: i % 3 === 0 ? 'search-toolbar' : null,
    durationMs: i % 5 === 0 ? rand(1000, 120000) : null,
    browser: BROWSERS[i % BROWSERS.length],
    os: OSES[i % OSES.length],
    deviceType: DEVICES[i % DEVICES.length],
    region: ['广东 深圳', '北京', '上海', '浙江 杭州'][i % 4],
    sessionId: `sess-${1000 + (i % 50)}`,
    memberId: null,
    source: 'web_admin',
    appId: 'admin',
    environment: 'production',
    createdAt: mockDateTime(),
  }));
}
const MOCK_EVENTS = buildEvents(120);


// ─── 行为中心阶段2：站点管理（内存）────────────────────────────────────────────
let mockSites: AnalyticsSite[] = SEED_ANALYTICS_SITES.map((site, index) => ({
  ...site,
  tenantName: null,
  todayUsage: site.dailyEventQuota ? Math.floor(site.dailyEventQuota * (index === 0 ? 0.92 : 0.35)) : rand(100, 1200),
  createdAt: mockDateTimeOffset(-60 * 86400000),
  updatedAt: mockDateTime(),
}));
let nextSiteId = Math.max(...mockSites.map((s) => s.id), 0) + 1;
function mockSiteKey(): string { return `zk_${Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32)}`; }


// ─── 行为中心阶段2：A/B 实验（内存）────────────────────────────────────────────
let mockExperiments: AnalyticsExperiment[] = [
  {
    id: 1,
    tenantId: null,
    tenantName: null,
    expKey: 'homepage_banner',
    name: '首页 Banner 文案实验',
    description: '对比不同 Banner 文案对提交订单的影响',
    status: 'running',
    trafficAllocation: 100,
    variants: [{ key: 'control', name: '对照组', weight: 50 }, { key: 'new_copy', name: '新文案', weight: 50 }],
    metricEventName: 'order_submit',
    startAt: mockDateTimeOffset(-7 * 86400000),
    endAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: mockDateTimeOffset(-8 * 86400000),
    updatedAt: mockDateTime(),
  },
  {
    id: 2,
    tenantId: null,
    tenantName: null,
    expKey: 'member_checkout_flow',
    name: '会员结算流程实验',
    description: '对比结算流程入口调整',
    status: 'draft',
    trafficAllocation: 60,
    variants: [{ key: 'control', name: '原流程', weight: 50 }, { key: 'short', name: '精简流程', weight: 50 }],
    metricEventName: 'payment.succeeded',
    startAt: null,
    endAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: mockDateTimeOffset(-3 * 86400000),
    updatedAt: mockDateTimeOffset(-1 * 86400000),
  },
];
let nextExperimentId = 3;

function mockPickExperimentVariant(exp: AnalyticsExperiment, distinctId: string): string | null {
  let hash = 0;
  for (const ch of `${exp.expKey}:${distinctId}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const bucket = hash % 100;
  if (bucket >= exp.trafficAllocation) return null;
  const variantBucket = Math.floor((bucket / Math.max(exp.trafficAllocation, 1)) * 100);
  let cursor = 0;
  for (const variant of exp.variants) {
    cursor += variant.weight;
    if (variantBucket < cursor) return variant.key;
  }
  return exp.variants.at(-1)?.key ?? null;
}

// ─── 行为中心阶段1：用户分群（内存）────────────────────────────────────────────
let mockSegments: AnalyticsUserSegment[] = [
  {
    id: 1,
    tenantId: null,
    name: '活跃下单用户',
    description: '最近 7 天内提交过订单事件的用户',
    rules: { operator: 'AND', conditions: [{ type: 'event', eventName: 'order_submit', days: 7, minCount: 1 }] },
    status: 'enabled',
    estimatedSize: 128,
    snapshotAt: mockDateTimeOffset(-2 * 86400000),
    createdAt: mockDateTimeOffset(-10 * 86400000),
    updatedAt: mockDateTimeOffset(-2 * 86400000),
  },
  {
    id: 2,
    tenantId: null,
    name: '桌面端会员用户',
    description: '身份类型为会员，且最近使用桌面端访问',
    rules: {
      operator: 'AND',
      conditions: [
        { type: 'attribute', field: 'identityType', op: 'eq', value: 'member' },
        { type: 'event', eventName: '$pageview', days: 30, minCount: 3 },
      ],
    },
    status: 'enabled',
    estimatedSize: 56,
    snapshotAt: mockDateTimeOffset(-1 * 86400000),
    createdAt: mockDateTimeOffset(-20 * 86400000),
    updatedAt: mockDateTimeOffset(-1 * 86400000),
  },
];
let nextSegmentId = 3;

function buildSegmentMembers(segmentId: number, count: number): AnalyticsSegmentMember[] {
  return Array.from({ length: count }, (_, i) => ({
    id: segmentId * 1000 + i + 1,
    segmentId,
    tenantId: null,
    distinctId: `u:${i + 1}`,
    identityType: i % 3 === 0 ? 'member' : i % 3 === 1 ? 'admin' : 'anonymous',
    userId: i % 3 === 1 ? i + 1 : null,
    memberId: i % 3 === 0 ? i + 1 : null,
    snapshotAt: mockDateTime(),
  }));
}
const mockSegmentMembers: Record<number, AnalyticsSegmentMember[]> = {
  1: buildSegmentMembers(1, 24),
  2: buildSegmentMembers(2, 12),
};
let mockCampaigns: AnalyticsSegmentCampaign[] = [
  {
    id: 1,
    tenantId: null,
    segmentId: 1,
    segmentName: '活跃下单用户',
    name: '下单用户优惠券触达',
    channel: 'in_app',
    templateId: 1,
    webhookUrl: null,
    status: 'completed',
    totalCount: 24,
    sentCount: 16,
    failedCount: 8,
    lastRunAt: mockDateTimeOffset(-3600000),
    lastError: '会员/匿名用户无站内信体系，已跳过 8 条',
    createdBy: 1,
    updatedBy: 1,
    createdAt: mockDateTimeOffset(-2 * 86400000),
    updatedAt: mockDateTimeOffset(-3600000),
  },
];
let nextCampaignId = 2;

// ─── 阶段1治理闭环：租户覆盖 / 质量看板 / 事件调试（内存）──────────────────────
const MOCK_OVERRIDE_TENANT_ID = 1;

let mockEventOverrides: AnalyticsEventOverride[] = [
  { id: 1, tenantId: MOCK_OVERRIDE_TENANT_ID, eventName: 'order_submit', status: 'disabled', reason: '联调期间临时下线', createdAt: mockDateTimeOffset(-2 * 86400000), updatedAt: mockDateTime() },
];
let nextOverrideId = 2;

const QUALITY_EVENT_NAMES = ['order_submit', '$autocapture', '$pageview'];
const QUALITY_ISSUE_TYPES: AnalyticsQualityIssueType[] = [...ANALYTICS_QUALITY_ISSUE_TYPES];

function buildQualitySample(issueType: AnalyticsQualityIssueType): Record<string, unknown> | null {
  if (issueType === 'event_disabled' || issueType === 'origin_rejected' || issueType === 'quota_exceeded') return null;
  if (issueType === 'missing_required') return { issues: [{ key: 'amount', expected: 'required' }] };
  if (issueType === 'type_mismatch') return { issues: [{ key: 'amount', expected: 'number', actualType: 'string' }] };
  return { issues: [{ key: 'channel', expected: 'wechat|alipay|cash', actualType: 'string' }] };
}

let nextQualityId = 1;
const mockQualityDaily: AnalyticsQualityDaily[] = (() => {
  const rows: AnalyticsQualityDaily[] = [];
  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const statDate = mockDateOffset(-dayOffset);
    QUALITY_EVENT_NAMES.forEach((eventName, ei) => {
      QUALITY_ISSUE_TYPES.forEach((issueType, ii) => {
        if ((dayOffset + ei + ii) % 3 !== 0) return; // 稀疏采样，非每天每种组合都有数据
        rows.push({
          id: nextQualityId++,
          tenantId: MOCK_OVERRIDE_TENANT_ID,
          statDate,
          eventName,
          issueType,
          count: rand(1, 40),
          sample: buildQualitySample(issueType),
          lastSeenAt: mockDateTime(),
          createdAt: mockDateTime(),
          updatedAt: mockDateTime(),
        });
      });
    });
  }
  return rows;
})();

export const analyticsHandlers = [

  http.get('/api/analytics/experiments/assignments', ({ request }) => {
    const u = new URL(request.url);
    const distinctId = u.searchParams.get('distinctId') || 'u:1';
    const keys = new Set((u.searchParams.get('keys') || '').split(',').map((v) => v.trim()).filter(Boolean));
    const data: AnalyticsExperimentAssignment[] = mockExperiments
      .filter((exp) => exp.status === 'running' && (keys.size === 0 || keys.has(exp.expKey)))
      .flatMap((exp) => {
        const variantKey = mockPickExperimentVariant(exp, distinctId);
        return variantKey ? [{ expKey: exp.expKey, variantKey }] : [];
      });
    return ok(data);
  }),

  http.get('/api/analytics/experiments', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const name = u.searchParams.get('name') || '';
    const status = u.searchParams.get('status') || '';
    const list = mockExperiments.filter((exp) => (!name || exp.name.includes(name)) && (!status || exp.status === status));
    return ok<PaginatedResponse<AnalyticsExperiment>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),

  http.get('/api/analytics/experiments/:id', ({ params }) => {
    const exp = mockExperiments.find((item) => item.id === Number(params.id));
    return exp ? ok(exp) : HttpResponse.json({ code: 404, message: '实验不存在', data: null }, { status: 404 });
  }),

  http.post('/api/analytics/experiments', async ({ request }) => {
    const body = await request.json() as Partial<AnalyticsExperiment>;
    const exp: AnalyticsExperiment = {
      id: nextExperimentId++, tenantId: null, tenantName: null, expKey: body.expKey || `exp_${Date.now()}`,
      name: body.name || '未命名实验', description: body.description ?? null, status: body.status || 'draft',
      trafficAllocation: body.trafficAllocation ?? 100, variants: body.variants || [{ key: 'control', name: '对照组', weight: 50 }, { key: 'treatment', name: '实验组', weight: 50 }],
      metricEventName: body.metricEventName || 'order_submit', startAt: body.startAt ?? null, endAt: body.endAt ?? null,
      createdBy: 1, updatedBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockExperiments.unshift(exp);
    return ok(exp, '创建成功');
  }),

  http.put('/api/analytics/experiments/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const index = mockExperiments.findIndex((item) => item.id === id);
    if (index < 0) return HttpResponse.json({ code: 404, message: '实验不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<AnalyticsExperiment>;
    mockExperiments[index] = { ...mockExperiments[index], ...body, updatedAt: mockDateTime() };
    return ok(mockExperiments[index], '更新成功');
  }),

  http.delete('/api/analytics/experiments/:id', ({ params }) => {
    mockExperiments = mockExperiments.filter((item) => item.id !== Number(params.id));
    return ok(null, '删除成功');
  }),

  http.post('/api/analytics/experiments/:id/:action', ({ params }) => {
    const exp = mockExperiments.find((item) => item.id === Number(params.id));
    if (!exp) return HttpResponse.json({ code: 404, message: '实验不存在', data: null }, { status: 404 });
    if (params.action === 'start') exp.status = 'running';
    if (params.action === 'pause') exp.status = 'paused';
    if (params.action === 'complete') exp.status = 'completed';
    exp.updatedAt = mockDateTime();
    return ok(exp, '操作成功');
  }),

  http.get('/api/analytics/experiments/:id/report', ({ params }) => {
    const exp = mockExperiments.find((item) => item.id === Number(params.id));
    if (!exp) return HttpResponse.json({ code: 404, message: '实验不存在', data: null }, { status: 404 });
    const report: AnalyticsExperimentReport = {
      experimentId: exp.id,
      expKey: exp.expKey,
      metricEventName: exp.metricEventName,
      variants: exp.variants.map((variant, index) => {
        const exposures = 420 + index * 83;
        const conversions = Math.floor(exposures * (0.08 + index * 0.025));
        return { variantKey: variant.key, exposures, conversions, conversionRate: Math.round((conversions / exposures) * 1000) / 10 };
      }),
    };
    return ok(report);
  }),

  http.get('/api/analytics/config', ({ request }) => {
    const u = new URL(request.url);
    const key = request.headers.get(ANALYTICS_SITE_KEY_HEADER) || u.searchParams.get('siteKey');
    const site = key ? mockSites.find((s) => s.siteKey === key && s.status === 'enabled') : undefined;
    return ok<AnalyticsPublicConfig>(site ? { ...PUBLIC_CONFIG, siteId: site.id, appId: site.appId } : PUBLIC_CONFIG);
  }),
  http.post('/api/analytics/events', () => ok(null, '上报成功')),

  http.get('/api/analytics/overview', () => ok<AnalyticsOverview>({
    pv: 18420, uv: 3240, sessions: 5870, events: 42100, newUsers: 412, avgSessionMs: 184000,
    bounceRate: 34.2, avgPagesPerSession: 4.7, pvDelta: 12.4, uvDelta: 8.1, sessionsDelta: -3.2,
    bounceRateDelta: -1.8, activeNow: rand(8, 42),
  })),

  http.get('/api/analytics/trends', ({ request }) => {
    const u = new URL(request.url);
    const startDate = u.searchParams.get('startDate');
    const endDate = u.searchParams.get('endDate');
    const compare = u.searchParams.get('compare') === 'true';
    const days = startDate && endDate
      ? Math.min(Math.max(Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1, 1), 365)
      : Number(u.searchParams.get('days')) || 30;
    const dates = daysAxis(days);
    const gen = (base: number, jitter: number) => dates.map(() => rand(base - jitter, base + jitter));
    const buildSeries = () => ([
      { key: 'pv', name: '浏览量(PV)', data: gen(620, 180) },
      { key: 'uv', name: '访客数(UV)', data: gen(120, 40) },
      { key: 'sessions', name: '会话数', data: gen(200, 60) },
      { key: 'events', name: '事件数', data: gen(1400, 400) },
    ]);
    return ok<TrendSeries>({
      dates,
      series: buildSeries(),
      ...(compare ? { compare: { dates: dates.map((d) => shiftDate(d, -days)), series: buildSeries() } } : {}),
    });
  }),

  http.get('/api/analytics/realtime', () => {
    const perMinute = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - (29 - i) * 60_000);
      return { minute: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, events: rand(2, 40) };
    });
    return ok<RealtimeStats>({
      activeUsers: rand(8, 40), pageViewsLast30Min: rand(120, 480), eventsLastMinute: rand(2, 30),
      topPages: MOCK_PAGES.items.slice(0, 6).map((p) => ({ pagePath: p.pagePath, pageTitle: p.pageTitle, active: rand(1, 20) })),
      recentEvents: MOCK_EVENTS.slice(0, 20).map((e) => ({ eventType: e.eventType, eventName: e.eventName, pagePath: e.pagePath, username: e.username, createdAt: e.createdAt })),
      perMinute,
    });
  }),

  http.get('/api/analytics/page-stats', () => ok<PageStats>(MOCK_PAGES)),
  http.get('/api/analytics/feature-stats', () => ok<FeatureStats>(MOCK_FEATURES)),
  http.get('/api/analytics/heatmap-pages', () => ok({ pages: MOCK_HEATMAP_PAGES })),
  http.get('/api/analytics/heatmap', ({ request }) => {
    const u = new URL(request.url);
    return ok<HeatmapData>(buildMockHeatmapData(u.searchParams.get('pagePath') ?? '/users', u.searchParams.get('componentArea') ?? 'table'));
  }),

  http.get('/api/analytics/user-stats', () => ok<UserStats>({
    totalUsers: 5,
    items: USERNAMES.map((u, i) => ({ userId: i + 1, username: u, totalEvents: rand(200, 2000), pageViews: rand(80, 600), uniquePages: rand(5, 30), featureUses: rand(40, 400), totalDwellMs: rand(600000, 6000000), lastActiveAt: mockDateTime() })),
  })),

  http.get('/api/analytics/sessions', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const all: SessionListItem[] = Array.from({ length: 86 }, (_, i) => ({
      id: 5000 - i, sessionId: `sess-${1000 + i}`, userId: rand(1, 6), username: USERNAMES[i % USERNAMES.length],
      startedAt: mockDateTime(), endedAt: mockDateTime(), durationMs: rand(20000, 900000), pageCount: rand(1, 18), eventCount: rand(2, 90),
      entryPage: MOCK_PAGES.items[i % MOCK_PAGES.items.length].pagePath, exitPage: MOCK_PAGES.items[(i + 2) % MOCK_PAGES.items.length].pagePath,
      referrer: i % 3 === 0 ? 'https://www.google.com' : null, browser: BROWSERS[i % BROWSERS.length], os: OSES[i % OSES.length],
      deviceType: DEVICES[i % DEVICES.length], region: ['广东 深圳', '北京', '上海'][i % 3], isBounce: i % 4 === 0,
      memberId: null, source: 'web_admin', appId: 'admin', environment: 'production',
    }));
    return ok<PaginatedResponse<SessionListItem>>({ list: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
  }),

  http.post('/api/analytics/funnel', async ({ request }) => {
    const body = (await request.json()) as { steps: { label: string }[] };
    const steps = body.steps ?? [];
    const total = 1000;
    let prev = total;
    const out = steps.map((s, i) => {
      const users = i === 0 ? total : Math.floor(prev * (0.55 + Math.random() * 0.3));
      const r = {
        label: s.label,
        users,
        conversionRate: Math.round((users / total) * 1000) / 10,
        stepConversionRate: Math.round((users / prev) * 1000) / 10,
        dropoff: prev - users,
        averageConversionMs: i === 0 ? null : rand(30_000, 3_600_000),
      };
      prev = users;
      return r;
    });
    return ok<FunnelResult>({ steps: out, totalUsers: total, overallConversionRate: out.length ? out[out.length - 1].conversionRate : 0 });
  }),

  http.get('/api/analytics/retention', ({ request }) => {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days')) || 14;
    const mode = (url.searchParams.get('mode') as 'first_seen' | 'window_first') || 'first_seen';
    const axis = daysAxis(days);
    const periods = Array.from({ length: Math.min(days, 8) }, (_, i) => i);
    const cohorts = axis.map((cohortDate, ci) => ({
      cohortDate, cohortSize: rand(20, 120),
      values: periods.map((p) => (ci + p >= axis.length ? null : Math.round((100 * Math.exp(-p / 4)) * 10) / 10)),
    }));
    return ok<RetentionResult>({ cohorts, periods, mode });
  }),

  http.get('/api/analytics/path', () => {
    const pages = MOCK_PAGES.items.map((p) => p.pagePath);
    const links = Array.from({ length: 12 }, (_, i) => ({ source: pages[i % pages.length], target: pages[(i + 1) % pages.length], value: rand(20, 200) }));
    const nodeSet = new Set<string>();
    links.forEach((l) => { nodeSet.add(l.source); nodeSet.add(l.target); });
    return ok<PathResult>({ nodes: [...nodeSet].map((id) => ({ id, label: id, value: rand(50, 400) })), links });
  }),

  http.get('/api/analytics/user-timeline', ({ request }) => {
    const userId = Number(new URL(request.url).searchParams.get('userId')) || 1;
    return ok<UserTimeline>({
      userId, username: USERNAMES[(userId - 1) % USERNAMES.length], totalEvents: rand(200, 1200), firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(),
      items: MOCK_EVENTS.slice(0, 60).map((e) => ({ id: e.id, eventType: e.eventType, eventName: e.eventName, pagePath: e.pagePath, pageTitle: e.pageTitle, elementLabel: e.elementLabel, componentArea: e.componentArea, durationMs: e.durationMs, sessionId: e.sessionId, properties: null, createdAt: e.createdAt })),
    });
  }),

  http.get('/api/analytics/session-timeline', ({ request }) => {
    const sessionId = new URL(request.url).searchParams.get('sessionId') ?? 'sess-1000';
    return ok<SessionTimeline>({
      sessionId,
      username: USERNAMES[0],
      userId: 1,
      startedAt: mockDateTimeOffset(-1800000),
      durationMs: rand(60000, 1800000),
      entryPage: '/dashboard',
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'Windows',
      items: MOCK_EVENTS.slice(0, 40).map((e, i) => ({ id: e.id, eventType: e.eventType, eventName: e.eventName, pagePath: e.pagePath, pageTitle: e.pageTitle, elementLabel: e.elementLabel, componentArea: e.componentArea, durationMs: e.durationMs, properties: null, createdAt: mockDateTimeOffset(-1800000 + i * 42000) })),
    });
  }),

  http.get('/api/analytics/reports', () => ok({ list: mockSavedReports })),
  http.post('/api/analytics/reports', async ({ request }) => {
    const body = (await request.json()) as { name: string; reportType?: string; config: Record<string, unknown> };
    const item: AnalyticsSavedReport = { id: nextReportId++, name: body.name, reportType: body.reportType ?? 'funnel', config: body.config, createdBy: 1, createdByName: 'admin', createdAt: mockDateTime() };
    mockSavedReports.unshift(item);
    return ok(item, '保存成功');
  }),
  http.delete('/api/analytics/reports/:id', ({ params }) => {
    mockSavedReports = mockSavedReports.filter((r) => r.id !== Number(params.id));
    return ok(null, '删除成功');
  }),

  http.get('/api/analytics/dimension', ({ request }) => {
    const dim = new URL(request.url).searchParams.get('dimension') ?? 'browser';
    const sets: Record<string, string[]> = { browser: BROWSERS, os: OSES, device: ['desktop', 'mobile', 'tablet'], region: ['广东', '北京', '上海', '浙江', '江苏'], source: ['google', 'direct', 'baidu', 'bing'], referrer: ['直接访问', 'google.com', 'baidu.com'], page: MOCK_PAGES.items.map((p) => p.pagePath) };
    const names = sets[dim] ?? BROWSERS;
    const raw = names.map((n) => ({ name: n, value: rand(50, 800) }));
    const total = raw.reduce((s, r) => s + r.value, 0);
    return ok<DimensionBreakdown>({ dimension: dim, total, items: raw.map((r) => ({ ...r, percent: Math.round((r.value / total) * 1000) / 10 })) });
  }),

  http.get('/api/analytics/dimension-cross', ({ request }) => {
    const u = new URL(request.url);
    const dim1 = u.searchParams.get('dim1') ?? 'browser';
    const dim2 = u.searchParams.get('dim2') ?? 'os';
    const sets: Record<string, string[]> = { browser: BROWSERS, os: OSES, device: ['desktop', 'mobile', 'tablet'], region: ['广东', '北京', '上海', '浙江', '江苏'], source: ['google', 'direct', 'baidu'], referrer: ['直接访问', 'google.com'], page: MOCK_PAGES.items.slice(0, 5).map((p) => p.pagePath) };
    const rowNames = sets[dim1] ?? BROWSERS;
    const columns = sets[dim2] ?? OSES;
    return ok<DimensionCross>({
      dim1,
      dim2,
      columns,
      rows: rowNames.map((name) => {
        const values = columns.map(() => rand(20, 400));
        return { name, total: values.reduce((s, v) => s + v, 0), values };
      }),
    });
  }),

  http.get('/api/analytics/perf-stats', () => ok<PerfStats>({
    items: [
      { metricName: 'LCP', count: 1820, avg: 2180, p75: 2450, p90: 3200, p99: 4800, rating: 'needs-improvement' },
      { metricName: 'INP', count: 1820, avg: 150, p75: 180, p90: 240, p99: 520, rating: 'good' },
      { metricName: 'CLS', count: 1820, avg: 0.06, p75: 0.08, p90: 0.12, p99: 0.28, rating: 'good' },
      { metricName: 'FCP', count: 1820, avg: 1400, p75: 1650, p90: 2100, p99: 3400, rating: 'good' },
      { metricName: 'TTFB', count: 1820, avg: 620, p75: 720, p90: 980, p99: 1900, rating: 'good' },
    ],
  })),

  http.get('/api/analytics/events/:id', ({ params }) => {
    const id = Number(params.id);
    const base = MOCK_EVENTS.find((e) => e.id === id) ?? MOCK_EVENTS[0];
    const detail: EventDetail = {
      ...base, distinctId: `u:${base.userId}`, anonymousId: 'anon-abc123', scrollDepth: rand(0, 100),
      properties: { foo: 'bar', amount: 42 }, referrer: 'https://www.google.com', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'spring',
      browserVersion: '120', osVersion: '11', screenW: 1920, screenH: 1080, language: 'zh-CN', userAgent: 'Mozilla/5.0 ...',
      ip: '113.88.x.x', country: '中国', city: '深圳', metricName: null, metricValue: null, sdkVersion: '1.0.0',
    };
    return ok<EventDetail>(detail);
  }),
  http.get('/api/analytics/events', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    return ok<PaginatedResponse<EventListItem>>({ list: MOCK_EVENTS.slice((page - 1) * pageSize, page * pageSize), total: MOCK_EVENTS.length, page, pageSize });
  }),
  http.delete('/api/analytics/clean', () => ok(null, '共删除 1024 条事件数据')),


  // 站点管理
  http.get('/api/analytics/sites', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const name = u.searchParams.get('name') ?? '';
    const appId = u.searchParams.get('appId') ?? '';
    const status = u.searchParams.get('status') ?? '';
    const list = mockSites.filter((site) =>
      (!name || site.name.includes(name))
      && (!appId || site.appId === appId)
      && (!status || site.status === status));
    return ok<PaginatedResponse<AnalyticsSite>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/analytics/sites', async ({ request }) => {
    const body = (await request.json()) as Partial<AnalyticsSite>;
    const siteKey = mockSiteKey();
    if (mockSites.some((site) => site.siteKey === siteKey)) return HttpResponse.json({ code: 400, message: '站点 Key 已存在', data: null }, { status: 400 });
    const item: AnalyticsSite = {
      id: nextSiteId++, tenantId: null, tenantName: null, siteKey,
      name: body.name ?? '未命名站点', appId: body.appId ?? 'admin', allowedOrigins: body.allowedOrigins?.length ? body.allowedOrigins : null,
      dailyEventQuota: body.dailyEventQuota ?? null, todayUsage: 0, status: body.status ?? 'enabled', remark: body.remark ?? null,
      createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockSites.unshift(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/analytics/sites/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<AnalyticsSite>;
    const idx = mockSites.findIndex((site) => site.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '站点不存在', data: null }, { status: 404 });
    mockSites[idx] = { ...mockSites[idx], ...body, allowedOrigins: body.allowedOrigins?.length ? body.allowedOrigins : null, updatedAt: mockDateTime() };
    return ok(mockSites[idx], '更新成功');
  }),
  http.delete('/api/analytics/sites/:id', ({ params }) => {
    mockSites = mockSites.filter((site) => site.id !== Number(params.id));
    return ok(null, '删除成功');
  }),
  http.post('/api/analytics/sites/:id/regenerate-key', ({ params }) => {
    const id = Number(params.id);
    const idx = mockSites.findIndex((site) => site.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '站点不存在', data: null }, { status: 404 });
    mockSites[idx] = { ...mockSites[idx], siteKey: mockSiteKey(), updatedAt: mockDateTime() };
    return ok(mockSites[idx], '重新生成成功');
  }),

  // 事件字典 CRUD
  http.get('/api/analytics/event-meta', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const kw = u.searchParams.get('keyword') ?? '';
    const list = mockEventMeta.filter((m) => !kw || m.eventName.includes(kw));
    return ok<PaginatedResponse<AnalyticsEventMeta>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/analytics/event-meta', async ({ request }) => {
    const body = (await request.json()) as Partial<AnalyticsEventMeta>;
    const item: AnalyticsEventMeta = { id: nextMetaId++, eventName: body.eventName ?? 'event', displayName: body.displayName ?? null, category: body.category ?? null, description: body.description ?? null, propertySchema: body.propertySchema ?? null, status: body.status ?? 'active', version: body.version ?? 1, ownerId: body.ownerId ?? null, ownerName: body.ownerName ?? null, strictMode: body.strictMode ?? false, eventCount: 0, firstSeenAt: null, lastSeenAt: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockEventMeta.unshift(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/analytics/event-meta/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<AnalyticsEventMeta>;
    const idx = mockEventMeta.findIndex((m) => m.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    mockEventMeta[idx] = { ...mockEventMeta[idx], ...body, updatedAt: mockDateTime() };
    return ok(mockEventMeta[idx], '更新成功');
  }),
  http.delete('/api/analytics/event-meta/:id', ({ params }) => {
    mockEventMeta = mockEventMeta.filter((m) => m.id !== Number(params.id));
    return ok(null, '删除成功');
  }),

  // 租户覆盖（Tracking Plan 租户级启停）
  http.get('/api/analytics/event-overrides', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const eventName = u.searchParams.get('eventName') ?? '';
    const status = u.searchParams.get('status') ?? '';
    const list = mockEventOverrides.filter((o) =>
      (!eventName || o.eventName.includes(eventName)) && (!status || o.status === status));
    return ok<PaginatedResponse<AnalyticsEventOverride>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/analytics/event-overrides', async ({ request }) => {
    const body = (await request.json()) as { eventName: string; status: AnalyticsEventOverride['status']; reason?: string | null };
    if (mockEventOverrides.some((o) => o.eventName === body.eventName)) {
      return HttpResponse.json({ code: 400, message: '该事件已存在租户覆盖配置', data: null }, { status: 400 });
    }
    const item: AnalyticsEventOverride = {
      id: nextOverrideId++, tenantId: MOCK_OVERRIDE_TENANT_ID, eventName: body.eventName,
      status: body.status, reason: body.reason ?? null, createdAt: mockDateTime(), updatedAt: mockDateTime(),
    };
    mockEventOverrides.unshift(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/analytics/event-overrides/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<AnalyticsEventOverride>;
    const idx = mockEventOverrides.findIndex((o) => o.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    mockEventOverrides[idx] = { ...mockEventOverrides[idx], ...body, updatedAt: mockDateTime() };
    return ok(mockEventOverrides[idx], '更新成功');
  }),
  http.delete('/api/analytics/event-overrides/:id', ({ params }) => {
    mockEventOverrides = mockEventOverrides.filter((o) => o.id !== Number(params.id));
    return ok(null, '删除成功');
  }),

  // 质量看板
  http.get('/api/analytics/quality', ({ request }) => {
    const u = new URL(request.url);
    const days = Number(u.searchParams.get('days')) || 7;
    const eventName = u.searchParams.get('eventName') ?? '';
    const issueType = u.searchParams.get('issueType') ?? '';
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const since = mockDateOffset(-(Math.max(1, days) - 1));
    const filtered = mockQualityDaily.filter((row) =>
      row.statDate >= since
      && (!eventName || row.eventName.includes(eventName))
      && (!issueType || row.issueType === issueType));
    const totalsMap = new Map<AnalyticsQualityIssueType, number>();
    filtered.forEach((row) => totalsMap.set(row.issueType, (totalsMap.get(row.issueType) ?? 0) + row.count));
    const totals = Array.from(totalsMap.entries()).map(([type, count]) => ({ issueType: type, count }));
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);
    return ok<AnalyticsQualityQueryResult>({ items, totals, totalCount: filtered.length });
  }),

  // 事件调试流
  http.get('/api/analytics/debug/events', ({ request }) => {
    const u = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(u.searchParams.get('limit')) || 50));
    const eventName = u.searchParams.get('eventName') ?? '';
    const source = MOCK_EVENTS.filter((e) => !eventName || (e.eventName ?? '').includes(eventName)).slice(0, limit);
    const list: AnalyticsDebugEvent[] = source.map((e) => ({
      id: e.id,
      eventId: `evt-${e.id}`,
      eventType: e.eventType,
      eventName: e.eventName,
      source: e.source,
      appId: e.appId,
      environment: e.environment,
      distinctId: `anon-${e.userId ?? 0}`,
      memberId: e.memberId,
      userId: e.userId,
      pagePath: e.pagePath,
      properties: e.elementKey ? { elementKey: e.elementKey, elementLabel: e.elementLabel, componentArea: e.componentArea } : null,
      createdAt: e.createdAt,
      issueTypes: Array.from(new Set(mockQualityDaily.filter((q) => q.eventName === e.eventName).map((q) => q.issueType))),
    }));
    return ok<AnalyticsDebugEvent[]>(list);
  }),

  // 设置
  http.get('/api/analytics/settings', () => ok<AnalyticsSettings>(mockSettings)),
  http.put('/api/analytics/settings', async ({ request }) => {
    const body = (await request.json()) as Partial<AnalyticsSettings>;
    mockSettings = { ...mockSettings, ...body, updatedAt: mockDateTime() };
    return ok(mockSettings, '更新成功');
  }),

  // 聚合
  http.get('/api/analytics/rollup', ({ request }) => {
    const days = Number(new URL(request.url).searchParams.get('days')) || 30;
    const items: AnalyticsRollupItem[] = daysAxis(days).reverse().map((statDate) => ({ statDate, pv: rand(400, 900), uv: rand(80, 200), sessions: rand(150, 300), events: rand(1000, 2000), bounceSessions: rand(30, 90), totalDwellMs: rand(20_000_000, 80_000_000) }));
    return ok({ items });
  }),
  http.post('/api/analytics/rollup/rebuild', ({ request }) => {
    const days = Number(new URL(request.url).searchParams.get('days')) || 30;
    return ok(createProgressingMockTask({
      taskType: 'analytics-rollup-rebuild',
      title: `重建近 ${days} 天聚合`,
      payload: { days },
      totalItems: Math.min(30, Math.max(1, days)),
    }), '任务已提交，可在任务中心查看进度');
  }),

  // ─── 通用事件分析工作台（行为中心阶段1）──────────────────────────────────────
  http.post('/api/analytics/events/query', async ({ request }) => {
    const body = (await request.json()) as AnalyticsEventQueryInput;
    const days = body.days ?? 30;
    const endDate = body.endDate ?? mockDateOffset(0);
    const startDate = body.startDate ?? shiftDate(endDate, -(days - 1));
    const groupBy: AnalyticsEventQueryGroupByField[] = body.groupBy && body.groupBy.length ? body.groupBy.slice(0, 2) : ['date'];
    const metric: AnalyticsEventQueryMetric = body.metric ?? 'events';
    const limit = Math.min(200, Math.max(1, body.limit ?? 100));

    let filtered = MOCK_EVENTS.filter((e) => {
      if (body.eventNames && body.eventNames.length && !body.eventNames.includes(e.eventName ?? '')) return false;
      if (body.source && e.source !== body.source) return false;
      if (body.appId && e.appId !== body.appId) return false;
      if (body.environment && e.environment !== body.environment) return false;
      if (body.deviceType && e.deviceType !== body.deviceType) return false;
      return true;
    });
    if (!filtered.length) filtered = MOCK_EVENTS.slice(0, 40);

    function dimValue(e: EventListItem, dim: AnalyticsEventQueryGroupByField, idx: number): string {
      switch (dim) {
        case 'date': return shiftDate(endDate, -(idx % days));
        case 'eventName': return e.eventName ?? '未知事件';
        case 'pagePath': return e.pagePath ?? '未知页面';
        case 'source': return e.source;
        case 'appId': return e.appId;
        case 'environment': return e.environment;
        case 'browser': return e.browser ?? '未知';
        case 'os': return e.os ?? '未知';
        case 'deviceType': return e.deviceType ?? '未知';
        case 'region': return e.region ?? '未知';
        default: return '未知';
      }
    }

    const bucket = new Map<string, { dimensions: Record<string, string>; count: number; users: Set<number> }>();
    filtered.forEach((e, idx) => {
      const dims: Record<string, string> = {};
      groupBy.forEach((dim) => { dims[dim] = dimValue(e, dim, idx); });
      const key = groupBy.map((dim) => dims[dim]).join('|');
      const entry = bucket.get(key) ?? { dimensions: dims, count: 0, users: new Set<number>() };
      entry.count += 1;
      if (e.userId != null) entry.users.add(e.userId);
      bucket.set(key, entry);
    });

    const rows: AnalyticsEventQueryRow[] = Array.from(bucket.values())
      .map((entry) => ({ dimensions: entry.dimensions, value: metric === 'uv' ? entry.users.size : entry.count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);

    return ok<AnalyticsEventQueryResult>({
      rows,
      total: rows.length,
      queryMeta: { metric, groupBy, startDate, endDate },
    });
  }),

  // ─── 用户分群 CRUD + 成员物化（行为中心阶段1）────────────────────────────────
  http.get('/api/analytics/segments', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const keyword = u.searchParams.get('keyword') ?? '';
    const status = u.searchParams.get('status') ?? '';
    const list = mockSegments.filter((s) =>
      (!keyword || s.name.includes(keyword) || (s.description ?? '').includes(keyword))
      && (!status || s.status === status));
    return ok<PaginatedResponse<AnalyticsUserSegment>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/analytics/segments', async ({ request }) => {
    const body = (await request.json()) as Partial<AnalyticsUserSegment>;
    if (!body.name || !body.rules || !body.rules.conditions?.length) {
      return HttpResponse.json({ code: 400, message: '分群名称与规则不能为空', data: null }, { status: 400 });
    }
    if (mockSegments.some((s) => s.name === body.name)) {
      return HttpResponse.json({ code: 400, message: '分群名称已存在', data: null }, { status: 400 });
    }
    const item: AnalyticsUserSegment = {
      id: nextSegmentId++,
      tenantId: null,
      name: body.name,
      description: body.description ?? null,
      rules: body.rules,
      status: body.status ?? 'enabled',
      estimatedSize: 0,
      snapshotAt: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockSegments.unshift(item);
    mockSegmentMembers[item.id] = [];
    return ok(item, '创建成功');
  }),
  http.get('/api/analytics/segments/:id', ({ params }) => {
    const item = mockSegments.find((s) => s.id === Number(params.id));
    if (!item) return HttpResponse.json({ code: 404, message: '分群不存在', data: null }, { status: 404 });
    return ok(item);
  }),
  http.put('/api/analytics/segments/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<AnalyticsUserSegment>;
    const idx = mockSegments.findIndex((s) => s.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '分群不存在', data: null }, { status: 404 });
    if (body.name && mockSegments.some((s) => s.id !== id && s.name === body.name)) {
      return HttpResponse.json({ code: 400, message: '分群名称已存在', data: null }, { status: 400 });
    }
    mockSegments[idx] = { ...mockSegments[idx], ...body, updatedAt: mockDateTime() };
    return ok(mockSegments[idx], '更新成功');
  }),
  http.delete('/api/analytics/segments/:id', ({ params }) => {
    const id = Number(params.id);
    mockSegments = mockSegments.filter((s) => s.id !== id);
    delete mockSegmentMembers[id];
    return ok(null, '删除成功');
  }),
  http.get('/api/analytics/segments/:id/members', ({ params, request }) => {
    const id = Number(params.id);
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const list = mockSegmentMembers[id] ?? [];
    return ok<PaginatedResponse<AnalyticsSegmentMember>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/analytics/segments/:id/materialize', ({ params }) => {
    const id = Number(params.id);
    const idx = mockSegments.findIndex((s) => s.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '分群不存在', data: null }, { status: 404 });
    // Demo 模式简化：提交任务的同时即时刷新一次快照，近似真实的异步物化效果
    const size = rand(20, 200);
    mockSegments[idx] = { ...mockSegments[idx], estimatedSize: size, snapshotAt: mockDateTime(), updatedAt: mockDateTime() };
    mockSegmentMembers[id] = buildSegmentMembers(id, size);
    const task = createProgressingMockTask({
      taskType: 'analytics-segment-materialize',
      title: `重算分群 #${id} 成员`,
      payload: { segmentId: id },
      totalItems: Math.max(1, Math.ceil(size / 10)),
    });
    return ok<AsyncTask>(task, '任务已提交，可在任务中心查看进度');
  }),

  // ─── 行为中心阶段2：分群触达（消息中心 + Webhook）──────────────────────────────
  http.get('/api/analytics/campaigns', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const segmentId = Number(u.searchParams.get('segmentId')) || undefined;
    const status = u.searchParams.get('status') ?? '';
    const list = mockCampaigns.filter((c) => (!segmentId || c.segmentId === segmentId) && (!status || c.status === status));
    return ok<PaginatedResponse<AnalyticsSegmentCampaign>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
  http.post('/api/analytics/campaigns', async ({ request }) => {
    const body = (await request.json()) as Partial<AnalyticsSegmentCampaign>;
    const segment = mockSegments.find((s) => s.id === Number(body.segmentId));
    if (!segment) return HttpResponse.json({ code: 404, message: '分群不存在', data: null }, { status: 404 });
    if (!body.name || !body.channel) return HttpResponse.json({ code: 400, message: '触达名称与渠道不能为空', data: null }, { status: 400 });
    if (body.channel === 'webhook' && !/^https?:\/\/.+/i.test(body.webhookUrl ?? '')) return HttpResponse.json({ code: 400, message: 'Webhook URL 不合法', data: null }, { status: 400 });
    if (body.channel !== 'webhook' && !body.templateId) return HttpResponse.json({ code: 400, message: '请选择消息模板', data: null }, { status: 400 });
    const item: AnalyticsSegmentCampaign = {
      id: nextCampaignId++,
      tenantId: null,
      segmentId: segment.id,
      segmentName: segment.name,
      name: body.name,
      channel: body.channel,
      templateId: body.channel === 'webhook' ? null : body.templateId ?? null,
      webhookUrl: body.channel === 'webhook' ? body.webhookUrl ?? null : null,
      status: 'draft',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      lastRunAt: null,
      lastError: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCampaigns.unshift(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/analytics/campaigns/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<AnalyticsSegmentCampaign>;
    const idx = mockCampaigns.findIndex((c) => c.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '触达活动不存在', data: null }, { status: 404 });
    if (mockCampaigns[idx].status !== 'draft') return HttpResponse.json({ code: 400, message: '仅草稿状态可修改', data: null }, { status: 400 });
    mockCampaigns[idx] = { ...mockCampaigns[idx], ...body, updatedAt: mockDateTime() };
    return ok(mockCampaigns[idx], '更新成功');
  }),
  http.delete('/api/analytics/campaigns/:id', ({ params }) => {
    const id = Number(params.id);
    const item = mockCampaigns.find((c) => c.id === id);
    if (item?.status === 'running') return HttpResponse.json({ code: 400, message: '执行中的触达活动不可删除', data: null }, { status: 400 });
    mockCampaigns = mockCampaigns.filter((c) => c.id !== id);
    return ok(null, '删除成功');
  }),
  http.post('/api/analytics/campaigns/:id/execute', ({ params }) => {
    const id = Number(params.id);
    const idx = mockCampaigns.findIndex((c) => c.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '触达活动不存在', data: null }, { status: 404 });
    const total = mockSegmentMembers[mockCampaigns[idx].segmentId]?.length ?? rand(20, 120);
    mockCampaigns[idx] = { ...mockCampaigns[idx], status: 'running', totalCount: total, sentCount: 0, failedCount: 0, lastError: null, updatedAt: mockDateTime() };
    setTimeout(() => {
      const current = mockCampaigns.findIndex((c) => c.id === id);
      if (current >= 0) {
        const failed = rand(0, Math.max(1, Math.floor(total * 0.2)));
        mockCampaigns[current] = { ...mockCampaigns[current], status: 'completed', sentCount: total - failed, failedCount: failed, lastRunAt: mockDateTime(), lastError: failed ? `模拟失败 ${failed} 条` : null, updatedAt: mockDateTime() };
      }
    }, 2000);
    const task = createProgressingMockTask({ taskType: 'analytics-campaign-execute', title: `执行分群触达 #${id}`, payload: { campaignId: id }, totalItems: Math.max(1, Math.ceil(total / 50)) });
    return ok<AsyncTask>(task, '任务已提交，可在任务中心查看进度');
  }),
];
