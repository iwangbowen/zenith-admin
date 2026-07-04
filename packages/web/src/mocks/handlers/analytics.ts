import { http, HttpResponse } from 'msw';
import type {
  PageStats, FeatureStats, HeatmapData, HeatmapPageListItem, UserStats, AnalyticsOverview,
  TrendSeries, RealtimeStats, SessionListItem, FunnelResult, RetentionResult, PathResult,
  UserTimeline, DimensionBreakdown, DimensionCross, PerfStats, EventListItem, EventDetail, AnalyticsEventMeta,
  AnalyticsSettings, AnalyticsPublicConfig, PaginatedResponse, AnalyticsRollupItem, UserBehaviorEventType,
  SessionTimeline, AnalyticsSavedReport,
} from '@zenith/shared';
import { mockDateTime, mockDateTimeOffset, mockDateOffset } from '../utils/date';

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
let mockEventMeta: AnalyticsEventMeta[] = [
  { id: 1, eventName: '$pageview', displayName: '页面浏览', category: 'page_view', description: '页面进入自动采集', propertySchema: null, status: 'active', eventCount: 18420, firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-30 * 86400000), updatedAt: mockDateTime() },
  { id: 2, eventName: '$autocapture', displayName: '自动点击', category: 'feature_use', description: '元素点击自动采集', propertySchema: null, status: 'active', eventCount: 9234, firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-30 * 86400000), updatedAt: mockDateTime() },
  { id: 3, eventName: '$web_vitals', displayName: 'Web Vitals', category: 'perf', description: '性能指标', propertySchema: null, status: 'active', eventCount: 5120, firstSeenAt: mockDateTimeOffset(-30 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-30 * 86400000), updatedAt: mockDateTime() },
  { id: 4, eventName: 'order_submit', displayName: '提交订单', category: 'custom', description: '业务自定义事件', propertySchema: [{ key: 'amount', type: 'number', description: '金额' }], status: 'active', eventCount: 842, firstSeenAt: mockDateTimeOffset(-20 * 86400000), lastSeenAt: mockDateTime(), createdAt: mockDateTimeOffset(-20 * 86400000), updatedAt: mockDateTime() },
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
    createdAt: mockDateTime(),
  }));
}
const MOCK_EVENTS = buildEvents(120);

export const analyticsHandlers = [
  http.get('/api/analytics/config', () => ok<AnalyticsPublicConfig>(PUBLIC_CONFIG)),
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
      const r = { label: s.label, users, conversionRate: Math.round((users / total) * 1000) / 10, stepConversionRate: Math.round((users / prev) * 1000) / 10, dropoff: prev - users };
      prev = users;
      return r;
    });
    return ok<FunnelResult>({ steps: out, totalUsers: total, overallConversionRate: out.length ? out[out.length - 1].conversionRate : 0 });
  }),

  http.get('/api/analytics/retention', ({ request }) => {
    const days = Number(new URL(request.url).searchParams.get('days')) || 14;
    const axis = daysAxis(days);
    const periods = Array.from({ length: Math.min(days, 8) }, (_, i) => i);
    const cohorts = axis.map((cohortDate, ci) => ({
      cohortDate, cohortSize: rand(20, 120),
      values: periods.map((p) => (ci + p >= axis.length ? null : Math.round((100 * Math.exp(-p / 4)) * 10) / 10)),
    }));
    return ok<RetentionResult>({ cohorts, periods });
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
      ip: '113.88.x.x', country: '中国', city: '深圳', metricName: null, metricValue: null,
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
    const item: AnalyticsEventMeta = { id: nextMetaId++, eventName: body.eventName ?? 'event', displayName: body.displayName ?? null, category: body.category ?? null, description: body.description ?? null, propertySchema: body.propertySchema ?? null, status: body.status ?? 'active', eventCount: 0, firstSeenAt: null, lastSeenAt: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
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
  http.post('/api/analytics/rollup/rebuild', () => ok(null, '已重建聚合记录')),
];
