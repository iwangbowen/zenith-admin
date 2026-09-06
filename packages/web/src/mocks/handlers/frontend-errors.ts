import type { ErrorAlertLog, ErrorAlertRule, ErrorEvent, ErrorGroup, ErrorLevel, FrontendErrorType, SourceMapItem } from '@zenith/shared/analytics';
import { frontendErrorContract } from '@zenith/shared/analytics';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime, mockDateTimeOffset, mockDateOffset } from '../utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

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
  environment: (['production', 'production', 'development'] as const)[i % 3],
  count: rand(1, 240),
  affectedUsers: rand(1, 80),
  firstSeenAt: mockDateTimeOffset(-rand(1, 30) * 86400000),
  lastSeenAt: mockDateTime(),
  resolvedAt: null,
  trend: Array.from({ length: 7 }, () => rand(0, 30)),
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
    source: 'web_admin' as const,
    appId: 'admin',
    environment: 'production' as const,
    memberId: null,
    replayId: i === 0 ? '11111111-1111-4111-8111-111111111111' : null,
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

function mockDateOffsetAxis(days: number): string[] {
  const arr: string[] = [];
  for (let i = days - 1; i >= 0; i--) arr.push(mockDateOffset(-i));
  return arr;
}

export const frontendErrorsHandlers = [
  mock(frontendErrorContract.report, ({ ok }) => ok(null, '上报成功')),

  mock(frontendErrorContract.overview, ({ query, ok }) => {
    const trend = mockDateOffsetAxis(query.days ?? 30).map((date) => ({ date, occurrences: rand(5, 60), groups: rand(1, 12) }));
    const byType = TYPES.map((errorType) => ({ errorType, groups: rand(1, 10), occurrences: rand(10, 200) }));
    const byLevel = LEVELS.map((level) => ({ level, groups: rand(1, 12), occurrences: rand(10, 240) }));
    return ok({
      totalGroups: mockGroups.length, unresolved: mockGroups.filter((g) => g.status === 'unresolved').length,
      totalOccurrences: mockGroups.reduce((s, g) => s + g.count, 0), affectedUsers: rand(80, 320), newToday: rand(2, 14),
      byType, byLevel, trend, topIssues: [...mockGroups].sort((a, b) => b.count - a.count).slice(0, 10),
    });
  }),

  mock(frontendErrorContract.groups, ({ query, ok, paginate }) => {
    let list = [...mockGroups];
    if (query.status) list = list.filter((g) => g.status === query.status);
    if (query.errorType) list = list.filter((g) => g.errorType === query.errorType);
    if (query.level) list = list.filter((g) => g.level === query.level);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(g) => g.message]);
    if (query.environment) list = list.filter((g) => g.environment === query.environment);
    return ok(paginate(list));
  }),

  mock(frontendErrorContract.batchUpdateGroupStatus, ({ query, body, ok }) => {
    mockGroups = mockGroups.map((g) => (body.ids.includes(g.id) ? { ...g, status: query.status } : g));
    return ok(null, `已更新 ${body.ids.length} 条`);
  }),
  mock(frontendErrorContract.batchDeleteGroups, ({ body, ok }) => {
    mockGroups = mockGroups.filter((g) => !body.ids.includes(g.id));
    return ok(null, `已删除 ${body.ids.length} 条`);
  }),

  mock(frontendErrorContract.groupDetail, ({ params, ok }) => {
    const group = mockGroups.find((g) => g.id === params.id) ?? mockGroups[0];
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
  mock(frontendErrorContract.updateGroup, ({ params, body, ok }) => {
    const idx = mockGroups.findIndex((g) => g.id === params.id);
    if (idx === -1) return notFound('不存在', { status: 404 });
    mockGroups[idx] = { ...mockGroups[idx], ...body, resolvedAt: body.status === 'resolved' ? mockDateTime() : null };
    return ok(mockGroups[idx], '更新成功');
  }),

  mock(frontendErrorContract.events, ({ query, ok, paginate }) => {
    const groupId = query.groupId || mockGroups[0].id;
    return ok(paginate(buildEvents(groupId, 40)));
  }),

  mock(frontendErrorContract.clean, ({ ok }) => ok(null, '共清除 320 条记录')),

  mock(frontendErrorContract.sourceMaps, ({ ok, paginate }) => ok(paginate(mockSourceMaps))),
  mock(frontendErrorContract.uploadSourceMap, ({ body, ok }) => {
    const item: SourceMapItem = { id: nextSmId++, release: body.release, fileName: body.fileName, size: body.content.length, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockSourceMaps.unshift(item);
    return ok(item, '上传成功');
  }),
  mock(frontendErrorContract.removeSourceMap, ({ params, ok }) => {
    mockSourceMaps = mockSourceMaps.filter((m) => m.id !== params.id);
    return ok(null, '删除成功');
  }),

  mock(frontendErrorContract.alerts, ({ ok, paginate }) => ok(paginate(mockAlerts))),
  mock(frontendErrorContract.createAlert, ({ body, ok }) => {
    const item: ErrorAlertRule = { id: nextAlertId++, name: body.name, errorType: body.errorType ?? null, level: body.level ?? null, condition: body.condition, thresholdCount: body.thresholdCount, windowMinutes: body.windowMinutes, channels: body.channels, webhookUrl: body.webhookUrl ?? null, recipients: body.recipients, enabled: body.enabled, lastTriggeredAt: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockAlerts.unshift(item);
    return ok(item, '创建成功');
  }),
  mock(frontendErrorContract.updateAlert, ({ params, body, ok }) => {
    const idx = mockAlerts.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('不存在', { status: 404 });
    mockAlerts[idx] = { ...mockAlerts[idx], ...body, updatedAt: mockDateTime() };
    return ok(mockAlerts[idx], '更新成功');
  }),
  mock(frontendErrorContract.removeAlert, ({ params, ok }) => {
    mockAlerts = mockAlerts.filter((a) => a.id !== params.id);
    return ok(null, '删除成功');
  }),
  mock(frontendErrorContract.testAlert, ({ ok }) => ok(null, '测试消息已发送，请检查各通知渠道')),

  mock(frontendErrorContract.alertLogs, ({ query, ok, paginate }) => {
    const list = query.ruleId ? mockAlertLogs.filter((l) => l.ruleId === query.ruleId) : mockAlertLogs;
    return ok(paginate(list));
  }),
];
