import { http, HttpResponse } from 'msw';
import type {
  ErrorGroup, ErrorEvent, ErrorOverview, SourceMapItem, ErrorAlertRule, ErrorAlertLog, PaginatedResponse,
  FrontendErrorType, ErrorLevel,
} from '@zenith/shared';
import { mockDateTime, mockDateTimeOffset, mockDateOffset } from '../utils/date';

const ok = <T>(data: T, message = 'ok') => HttpResponse.json({ code: 0, message, data });
const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));

const TYPES: FrontendErrorType[] = ['js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash'];
const LEVELS: ErrorLevel[] = ['fatal', 'error', 'warning', 'info'];
const MESSAGES = [
  "Cannot read properties of undefined (reading 'map')",
  'Network Error: Failed to fetch /api/users',
  'Uncaught TypeError: x is not a function',
  'ResourceError: failed to load chunk vendor-abc.js',
  'Unhandled promise rejection: timeout',
  'GET /api/orders 500 Internal Server Error',
  '检测到疑似白屏：根节点无渲染内容',
];

let mockGroups: ErrorGroup[] = Array.from({ length: 48 }, (_, i) => ({
  id: 2000 - i,
  fingerprint: `fp${(1000 + i).toString(16)}`,
  errorType: TYPES[i % TYPES.length],
  level: LEVELS[i % LEVELS.length],
  message: MESSAGES[i % MESSAGES.length],
  status: (['unresolved', 'unresolved', 'resolved', 'ignored', 'muted'] as const)[i % 5],
  assigneeId: i % 4 === 0 ? 1 : null,
  assigneeName: i % 4 === 0 ? '管理员' : null,
  release: i % 2 === 0 ? 'v1.2.0' : 'v1.1.0',
  note: null,
  count: rand(1, 240),
  affectedUsers: rand(1, 80),
  firstSeenAt: mockDateTimeOffset(-rand(1, 30) * 86400000),
  lastSeenAt: mockDateTime(),
  resolvedAt: null,
}));

function buildEvents(groupId: number, n: number): ErrorEvent[] {
  const g = mockGroups.find((x) => x.id === groupId) ?? mockGroups[0];
  return Array.from({ length: n }, (_, i) => ({
    id: groupId * 100 + i,
    groupId,
    fingerprint: g.fingerprint,
    errorType: g.errorType,
    level: g.level,
    message: g.message,
    stack: `${g.message}\n    at handleClick (https://app.example.com/assets/index-abc.js:1:2345)\n    at onClick (https://app.example.com/assets/index-abc.js:1:1180)`,
    sourceUrl: 'https://app.example.com/assets/index-abc.js',
    lineNo: 1,
    colNo: 2345,
    pageUrl: 'https://app.example.com/#/users',
    release: g.release,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
    browser: ['Chrome', 'Edge', 'Safari'][i % 3],
    browserVersion: '120',
    os: ['Windows', 'macOS', 'iOS'][i % 3],
    deviceType: (['desktop', 'mobile', 'tablet'] as const)[i % 3],
    userId: rand(1, 6),
    username: ['admin', 'zhangsan', 'lisi'][i % 3],
    sessionId: `sess-${1000 + i}`,
    breadcrumbs: [
      { type: 'navigation' as const, message: '进入 用户管理 (/users)', timestamp: mockDateTimeOffset(-5000) },
      { type: 'click' as const, message: '点击 查询', timestamp: mockDateTimeOffset(-3000) },
      { type: 'http' as const, message: 'GET /api/users → 200', level: 'info' as const, timestamp: mockDateTimeOffset(-2000) },
      { type: 'console' as const, message: g.message, level: 'error' as const, timestamp: mockDateTimeOffset(-100) },
    ],
    context: { route: '/users', viewport: '1920x1080' },
    httpStatus: g.errorType === 'http_error' ? 500 : null,
    httpMethod: g.errorType === 'http_error' ? 'GET' : null,
    httpUrl: g.errorType === 'http_error' ? '/api/orders' : null,
    createdAt: mockDateTimeOffset(-i * 3600000),
  }));
}

let mockSourceMaps: SourceMapItem[] = [
  { id: 1, release: 'v1.2.0', fileName: 'index-abc.js', size: 482000, createdAt: mockDateTimeOffset(-2 * 86400000), updatedAt: mockDateTimeOffset(-2 * 86400000) },
  { id: 2, release: 'v1.2.0', fileName: 'vendor-def.js', size: 1240000, createdAt: mockDateTimeOffset(-2 * 86400000), updatedAt: mockDateTimeOffset(-2 * 86400000) },
];
let nextSmId = 3;

let mockAlerts: ErrorAlertRule[] = [
  { id: 1, name: '致命错误即时告警', errorType: null, level: 'fatal', condition: 'new_error', thresholdCount: 1, windowMinutes: 5, channels: ['email', 'webhook'], webhookUrl: 'https://hooks.example.com/x', recipients: ['ops@example.com'], enabled: true, lastTriggeredAt: mockDateTimeOffset(-3600000), createdAt: mockDateTimeOffset(-10 * 86400000), updatedAt: mockDateTime() },
  { id: 2, name: '错误激增告警', errorType: null, level: null, condition: 'spike', thresholdCount: 50, windowMinutes: 30, channels: ['inapp'], webhookUrl: null, recipients: [], enabled: true, lastTriggeredAt: null, createdAt: mockDateTimeOffset(-8 * 86400000), updatedAt: mockDateTime() },
];
let nextAlertId = 3;

const mockAlertLogs: ErrorAlertLog[] = Array.from({ length: 26 }, (_, i) => ({
  id: 500 - i,
  ruleId: (i % 3 === 0 ? 2 : 1),
  ruleName: i % 3 === 0 ? '错误激增告警' : '致命错误即时告警',
  condition: (i % 3 === 0 ? 'spike' : 'new_error') as ErrorAlertLog['condition'],
  detail: i % 3 === 0 ? `错误激增：当前周期 ${rand(60, 160)} 次，上一周期 ${rand(5, 25)} 次` : '出现新类型错误（实时检测）',
  channels: i % 3 === 0 ? ['inapp'] : ['email', 'webhook'],
  source: i % 2 === 0 ? 'realtime' : 'cron',
  createdAt: mockDateTimeOffset(-i * 5400000),
}));

export const frontendErrorsHandlers = [
  http.post('/api/frontend-errors', () => ok(null, '上报成功')),

  http.get('/api/frontend-errors/overview', ({ request }) => {
    const days = Number(new URL(request.url).searchParams.get('days')) || 30;
    const trend = mockDateOffsetAxis(days).map((date) => ({ date, occurrences: rand(5, 60), groups: rand(1, 12) }));
    const byType = TYPES.map((errorType) => ({ errorType, groups: rand(1, 10), occurrences: rand(10, 200) }));
    const byLevel = LEVELS.map((level) => ({ level, groups: rand(1, 12), occurrences: rand(10, 240) }));
    return ok<ErrorOverview>({
      totalGroups: mockGroups.length, unresolved: mockGroups.filter((g) => g.status === 'unresolved').length,
      totalOccurrences: mockGroups.reduce((s, g) => s + g.count, 0), affectedUsers: rand(80, 320), newToday: rand(2, 14),
      byType, byLevel, trend, topIssues: [...mockGroups].sort((a, b) => b.count - a.count).slice(0, 10),
    });
  }),

  http.get('/api/frontend-errors/groups', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const status = u.searchParams.get('status');
    const errorType = u.searchParams.get('errorType');
    const level = u.searchParams.get('level');
    const keyword = u.searchParams.get('keyword') ?? '';
    let list = [...mockGroups];
    if (status) list = list.filter((g) => g.status === status);
    if (errorType) list = list.filter((g) => g.errorType === errorType);
    if (level) list = list.filter((g) => g.level === level);
    if (keyword) list = list.filter((g) => g.message.includes(keyword));
    return ok<PaginatedResponse<ErrorGroup>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),

  http.post('/api/frontend-errors/groups/batch-status', async ({ request }) => {
    const u = new URL(request.url);
    const status = (u.searchParams.get('status') ?? 'resolved') as ErrorGroup['status'];
    const body = (await request.json()) as { ids: number[] };
    mockGroups = mockGroups.map((g) => (body.ids.includes(g.id) ? { ...g, status } : g));
    return ok(null, `已更新 ${body.ids.length} 条`);
  }),
  http.delete('/api/frontend-errors/groups/batch', async ({ request }) => {
    const body = (await request.json()) as { ids: number[] };
    mockGroups = mockGroups.filter((g) => !body.ids.includes(g.id));
    return ok(null, `已删除 ${body.ids.length} 条`);
  }),

  http.get('/api/frontend-errors/groups/:id', ({ params }) => {
    const id = Number(params.id);
    const group = mockGroups.find((g) => g.id === id) ?? mockGroups[0];
    const recentEvents = buildEvents(group.id, 8);
    return ok({
      group,
      symbolicatedStack: `${group.message}\n    at handleClick (src/pages/users/UsersPage.tsx:142:11)\n    at onClick (src/components/SearchToolbar.tsx:38:6)`,
      trend: mockDateOffsetAxis(14).map((date) => ({ date, count: rand(0, 30) })),
      browsers: [{ name: 'Chrome', value: rand(20, 80) }, { name: 'Edge', value: rand(5, 30) }, { name: 'Safari', value: rand(2, 20) }],
      os: [{ name: 'Windows', value: rand(20, 70) }, { name: 'macOS', value: rand(5, 30) }, { name: 'iOS', value: rand(2, 18) }],
      recentEvents,
    });
  }),
  http.put('/api/frontend-errors/groups/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<ErrorGroup>;
    const idx = mockGroups.findIndex((g) => g.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    mockGroups[idx] = { ...mockGroups[idx], ...body, resolvedAt: body.status === 'resolved' ? mockDateTime() : null };
    return ok(mockGroups[idx], '更新成功');
  }),

  http.get('/api/frontend-errors/events', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const groupId = Number(u.searchParams.get('groupId')) || mockGroups[0].id;
    const all = buildEvents(groupId, 40);
    return ok<PaginatedResponse<ErrorEvent>>({ list: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
  }),

  http.delete('/api/frontend-errors/clean', () => ok(null, '共清除 320 条记录')),

  http.get('/api/frontend-errors/source-maps', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    return ok<PaginatedResponse<SourceMapItem>>({ list: mockSourceMaps.slice((page - 1) * pageSize, page * pageSize), total: mockSourceMaps.length, page, pageSize });
  }),
  http.post('/api/frontend-errors/source-maps', async ({ request }) => {
    const body = (await request.json()) as { release: string; fileName: string; content: string };
    const item: SourceMapItem = { id: nextSmId++, release: body.release, fileName: body.fileName, size: body.content?.length ?? 0, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockSourceMaps.unshift(item);
    return ok(item, '上传成功');
  }),
  http.delete('/api/frontend-errors/source-maps/:id', ({ params }) => {
    mockSourceMaps = mockSourceMaps.filter((m) => m.id !== Number(params.id));
    return ok(null, '删除成功');
  }),

  http.get('/api/frontend-errors/alerts', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    return ok<PaginatedResponse<ErrorAlertRule>>({ list: mockAlerts.slice((page - 1) * pageSize, page * pageSize), total: mockAlerts.length, page, pageSize });
  }),
  http.post('/api/frontend-errors/alerts', async ({ request }) => {
    const body = (await request.json()) as Partial<ErrorAlertRule>;
    const item: ErrorAlertRule = { id: nextAlertId++, name: body.name ?? '新规则', errorType: body.errorType ?? null, level: body.level ?? null, condition: body.condition ?? 'threshold', thresholdCount: body.thresholdCount ?? 10, windowMinutes: body.windowMinutes ?? 60, channels: body.channels ?? [], webhookUrl: body.webhookUrl ?? null, recipients: body.recipients ?? [], enabled: body.enabled ?? true, lastTriggeredAt: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockAlerts.unshift(item);
    return ok(item, '创建成功');
  }),
  http.put('/api/frontend-errors/alerts/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<ErrorAlertRule>;
    const idx = mockAlerts.findIndex((a) => a.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '不存在', data: null }, { status: 404 });
    mockAlerts[idx] = { ...mockAlerts[idx], ...body, updatedAt: mockDateTime() };
    return ok(mockAlerts[idx], '更新成功');
  }),
  http.delete('/api/frontend-errors/alerts/:id', ({ params }) => {
    mockAlerts = mockAlerts.filter((a) => a.id !== Number(params.id));
    return ok(null, '删除成功');
  }),

  http.get('/api/frontend-errors/alert-logs', ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get('page')) || 1;
    const pageSize = Number(u.searchParams.get('pageSize')) || 20;
    const ruleId = u.searchParams.get('ruleId');
    const list = ruleId ? mockAlertLogs.filter((l) => l.ruleId === Number(ruleId)) : mockAlertLogs;
    return ok<PaginatedResponse<ErrorAlertLog>>({ list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize });
  }),
];

function mockDateOffsetAxis(days: number): string[] {
  const arr: string[] = [];
  for (let i = days - 1; i >= 0; i--) arr.push(mockDateOffset(-i));
  return arr;
}
