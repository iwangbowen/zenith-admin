import type { ErrorAlertLog, ErrorAlertRule, ErrorEvent, ErrorGroup, ServerErrorType } from '@zenith/shared/analytics';
import { ERROR_LEVELS, SERVER_ERROR_TYPES } from '@zenith/shared/analytics';
import { exceptionLogContract, type ExceptionGroupDetail, type ExceptionOverview } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { removeByIds, requireItem, updateItem } from '@/mocks/utils/crud';
import { filterByKeyword, matchesFilter, withinDateRange } from '@/mocks/utils/filter';
import { nextIdFrom, notFound } from '@/mocks/utils/handlers';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { mockUsers } from '@/mocks/data/users';

const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));

const SAMPLES: Array<{ type: ServerErrorType; name: string; message: string; route?: string; method?: string; status?: number; job?: string }> = [
  { type: 'server_exception', name: 'PostgresError', message: 'relation "report_snapshots" does not exist', route: '/api/reports/{id}/snapshot', method: 'GET', status: 500 },
  { type: 'server_exception', name: 'TypeError', message: "Cannot read properties of undefined (reading 'tenantId')", route: '/api/users/{id}/roles', method: 'PUT', status: 500 },
  { type: 'job_failure', name: 'Error', message: '导出任务超时：等待数据库响应超过 30000ms', job: 'export' },
  { type: 'cron_failure', name: 'Error', message: 'connect ECONNREFUSED 127.0.0.1:6379', job: 'system:cache-warmup' },
  { type: 'event_failure', name: 'ZodError', message: 'Invalid payload for workflow.instance.approved', job: 'workflow.instance.approved' },
  { type: 'process_crash', name: 'unhandledRejection', message: 'FATAL: too many connections for role "zenith"' },
  { type: 'logged_error', name: 'Error', message: '[sms] 供应商回调签名校验失败', job: 'sms:callback' },
];

const mockGroups: ErrorGroup[] = SAMPLES.map((sample, i) => ({
  id: 9000 - i,
  fingerprint: `srv${(4000 + i).toString(16)}`,
  source: 'server' as const,
  errorType: sample.type,
  level: sample.type === 'process_crash' ? 'fatal' : sample.type === 'job_failure' ? 'warning' : 'error',
  message: sample.message,
  status: (['unresolved', 'unresolved', 'resolved', 'unresolved', 'ignored', 'unresolved', 'muted'] as const)[i % 7],
  assigneeId: i % 3 === 0 ? 1 : null,
  assigneeName: i % 3 === 0 ? '管理员' : null,
  release: '2.36.0',
  note: null,
  environment: 'production' as const,
  count: rand(1, 120),
  affectedUsers: rand(0, 12),
  firstSeenAt: mockDateTimeOffset(-rand(1, 20) * 86400000),
  lastSeenAt: mockDateTimeOffset(-rand(0, 6) * 3600000),
  resolvedAt: null,
  trend: Array.from({ length: 7 }, () => rand(0, 12)),
}));

function buildEvents(group: ErrorGroup, n: number): ErrorEvent[] {
  const sample = SAMPLES.find((s) => s.message === group.message) ?? SAMPLES[0];
  return Array.from({ length: n }, (_, i) => {
    const user = mockUsers[i % mockUsers.length];
    const request = sample.route ? {
      method: sample.method,
      url: `http://localhost:3300${sample.route.replace('{id}', String(40 + i))}?page=1`,
      route: sample.route,
      status: sample.status,
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/124', 'x-request-id': `req-${group.id}-${i}` },
      query: { page: '1' },
      params: { id: String(40 + i) },
      body: sample.method === 'PUT' ? { roleIds: [1, 2], password: '***' } : undefined,
    } : undefined;
    return {
      id: group.id * 100 + i,
      groupId: group.id,
      fingerprint: group.fingerprint,
      errorType: group.errorType,
      level: group.level,
      message: group.message,
      stack: `${sample.name}: ${group.message}\n    at handler (file:///app/dist/routes/${sample.route ? 'identity/users.js' : 'tasks/runner.js'}:88:15)\n    at async dispatch (/app/node_modules/hono/dist/compose.js:29:17)`,
      sourceUrl: null,
      lineNo: null,
      colNo: null,
      pageUrl: null,
      release: '2.36.0',
      userAgent: null,
      browser: null,
      browserVersion: null,
      os: null,
      deviceType: null,
      userId: sample.route ? user.id : null,
      username: sample.route ? user.username : null,
      sessionId: null,
      breadcrumbs: null,
      context: {
        ...(request ? { request } : {}),
        ...(sample.job ? { job: { type: sample.job, id: 500 + i, attempt: 1, maxAttempts: 3, final: group.level !== 'warning' } } : {}),
        errorDetails: sample.name === 'PostgresError' ? { code: '42P01', severity: 'ERROR' } : undefined,
      },
      httpStatus: sample.status ?? null,
      httpMethod: sample.method ?? null,
      httpUrl: request?.url ?? null,
      source: 'server' as const,
      appId: 'server',
      environment: 'production' as const,
      memberId: null,
      replayId: null,
      correlationId: `req-${group.id}-${i}`,
      route: sample.route ?? null,
      errorName: sample.name,
      errorCode: sample.name === 'PostgresError' ? '42P01' : null,
      jobType: sample.job ?? null,
      jobId: sample.job ? String(500 + i) : null,
      processRole: sample.job ? 'worker' : 'api',
      hostname: i % 2 === 0 ? 'zenith-api-1' : 'zenith-api-2',
      pid: 4000 + (i % 2),
      affectedTenantId: i % 3 === 0 ? 1 : null,
      createdAt: mockDateTimeOffset(-i * 1800000),
    };
  });
}

const mockEvents: ErrorEvent[] = mockGroups.flatMap((group) => buildEvents(group, 4));

const mockAlerts: ErrorAlertRule[] = [
  { id: 701, name: '服务端新异常即时告警', source: 'server', errorType: null, level: null, condition: 'new_error', thresholdCount: 1, windowMinutes: 10, channels: ['inapp'], webhookUrl: null, recipients: ['admin'], enabled: true, lastTriggeredAt: mockDateTimeOffset(-7200000), createdAt: mockDateTimeOffset(-5 * 86400000), updatedAt: mockDateTime() },
  { id: 702, name: '进程崩溃邮件告警', source: 'server', errorType: 'process_crash', level: 'fatal', condition: 'threshold', thresholdCount: 1, windowMinutes: 60, channels: ['inapp', 'email'], webhookUrl: null, recipients: ['ops@example.com'], enabled: true, lastTriggeredAt: null, createdAt: mockDateTimeOffset(-3 * 86400000), updatedAt: mockDateTime() },
];

const mockAlertLogs: ErrorAlertLog[] = Array.from({ length: 6 }, (_, i) => ({
  id: 800 - i,
  ruleId: 701,
  ruleName: '服务端新异常即时告警',
  condition: 'new_error' as const,
  detail: '出现新类型错误（实时检测）',
  channels: ['inapp'],
  source: i % 2 === 0 ? 'realtime' : 'cron',
  createdAt: mockDateTimeOffset(-i * 5400000),
}));

function overview(): ExceptionOverview {
  const byType = SERVER_ERROR_TYPES.map((errorType) => {
    const groups = mockGroups.filter((g) => g.errorType === errorType);
    return { errorType, groups: groups.length, occurrences: groups.reduce((sum, g) => sum + g.count, 0) };
  }).filter((item) => item.groups > 0);
  const byLevel = ERROR_LEVELS.map((level) => {
    const groups = mockGroups.filter((g) => g.level === level);
    return { level, groups: groups.length, occurrences: groups.reduce((sum, g) => sum + g.count, 0) };
  }).filter((item) => item.groups > 0);
  return {
    totalGroups: mockGroups.length,
    unresolved: mockGroups.filter((g) => g.status === 'unresolved').length,
    totalOccurrences: mockGroups.reduce((sum, g) => sum + g.count, 0),
    newToday: 1,
    occurrences24h: mockEvents.length,
    byType,
    byLevel,
    trend: Array.from({ length: 30 }, (_, i) => ({ date: mockDateTimeOffset(-(29 - i) * 86400000).slice(0, 10), occurrences: rand(0, 20), groups: rand(0, 4) })),
    topIssues: mockGroups.filter((g) => g.status === 'unresolved').slice(0, 5),
  };
}

export const exceptionLogHandlers = [
  mock(exceptionLogContract.overview, ({ ok }) => ok(overview())),
  mock(exceptionLogContract.reporterStatus, ({ ok }) => ok({
    enabled: true, captured: 128, stored: 120, countOnly: 6, dropped: 0, ignored: 2, flushFailures: 0, pending: 0, paused: false,
    hostname: 'zenith-api-1', pid: 4000, processRole: 'api',
  })),

  mock(exceptionLogContract.groups, ({ query, ok, paginate }) => {
    const list = mockGroups
      .filter((g) => matchesFilter(g.status, query.status) && matchesFilter(g.errorType, query.errorType) && matchesFilter(g.level, query.level) && matchesFilter(g.environment, query.environment))
      .filter((g) => matchesFilter(g.assigneeId ?? undefined, query.assigneeId))
      .filter((g) => withinDateRange(g.lastSeenAt, query.startTime, query.endTime));
    return ok(paginate(filterByKeyword(list, query.keyword, [(g) => g.message])));
  }),
  mock(exceptionLogContract.batchUpdateGroupStatus, ({ query, body, ok }) => {
    for (const id of body.ids) {
      const g = mockGroups.find((item) => item.id === id);
      if (g) { g.status = query.status; g.resolvedAt = query.status === 'resolved' ? mockDateTime() : null; }
    }
    return ok(null, `已更新 ${body.ids.length} 条`);
  }),
  mock(exceptionLogContract.batchDeleteGroups, ({ body, ok }) => {
    const removed = removeByIds(mockGroups, body.ids);
    const ids = new Set(body.ids);
    for (let i = mockEvents.length - 1; i >= 0; i -= 1) if (ids.has(mockEvents[i].groupId)) mockEvents.splice(i, 1);
    return ok(null, `已删除 ${removed} 条`);
  }),
  mock(exceptionLogContract.groupDetail, ({ params, ok }) => {
    const group = requireItem(mockGroups, params.id, '异常分组不存在', { status: 404 });
    const events = mockEvents.filter((e) => e.groupId === group.id);
    const count = (key: (e: ErrorEvent) => string) => {
      const map = new Map<string, number>();
      for (const e of events) map.set(key(e), (map.get(key(e)) ?? 0) + 1);
      return [...map.entries()].map(([name, value]) => ({ name, value }));
    };
    const detail: ExceptionGroupDetail = {
      group,
      trend: Array.from({ length: 14 }, (_, i) => ({ date: mockDateTimeOffset(-(13 - i) * 86400000).slice(0, 10), count: rand(0, 6) })),
      routes: count((e) => e.route ?? e.jobType ?? '-'),
      hosts: count((e) => e.hostname ?? '-'),
      affectedTenants: [{ tenantId: null, value: events.filter((e) => e.affectedTenantId === null).length }, { tenantId: 1, value: events.filter((e) => e.affectedTenantId === 1).length }].filter((t) => t.value > 0),
      recentEvents: events,
    };
    return ok(detail);
  }),
  mock(exceptionLogContract.updateGroup, ({ params, body, ok }) => {
    const assigneeName = body.assigneeId ? (mockUsers.find((u) => u.id === body.assigneeId)?.nickname ?? null) : body.assigneeId === null ? null : undefined;
    const updated = updateItem(mockGroups, params.id, {
      ...(body.status !== undefined ? { status: body.status, resolvedAt: body.status === 'resolved' ? mockDateTime() : null } : {}),
      ...(body.level !== undefined ? { level: body.level } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId, assigneeName: assigneeName ?? null } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    }, { notFoundMessage: '异常分组不存在', init: { status: 404 } });
    return ok(updated, '更新成功');
  }),

  mock(exceptionLogContract.events, ({ query, ok, paginate }) => {
    const list = mockEvents
      .filter((e) => matchesFilter(e.groupId, query.groupId) && matchesFilter(e.errorType, query.errorType) && matchesFilter(e.level, query.level))
      .filter((e) => !query.correlationId || (e.correlationId ?? '').startsWith(query.correlationId))
      .filter((e) => withinDateRange(e.createdAt, query.startTime, query.endTime));
    return ok(paginate(filterByKeyword(filterByKeyword(filterByKeyword(list, query.route, [(e) => e.route]), query.jobType, [(e) => e.jobType]), query.hostname, [(e) => e.hostname])));
  }),
  mock(exceptionLogContract.eventDetail, ({ params, ok }) => {
    const event = mockEvents.find((e) => e.id === params.id);
    if (!event) return notFound('异常事件不存在', { status: 404 });
    return ok(event);
  }),

  mock(exceptionLogContract.alerts, ({ ok, paginate }) => ok(paginate(mockAlerts))),
  mock(exceptionLogContract.createAlert, ({ body, ok }) => {
    const item: ErrorAlertRule = { id: nextIdFrom(mockAlerts), name: body.name, source: 'server', errorType: body.errorType ?? null, level: body.level ?? null, condition: body.condition, thresholdCount: body.thresholdCount, windowMinutes: body.windowMinutes, channels: body.channels, webhookUrl: body.webhookUrl ?? null, recipients: body.recipients, enabled: body.enabled, lastTriggeredAt: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockAlerts.unshift(item);
    return ok(item, '创建成功');
  }),
  mock(exceptionLogContract.updateAlert, ({ params, body, ok }) => {
    const updated = updateItem(mockAlerts, params.id, body, { notFoundMessage: '告警规则不存在', now: mockDateTime, init: { status: 404 } });
    return ok(updated, '更新成功');
  }),
  mock(exceptionLogContract.removeAlert, ({ params, ok }) => {
    removeByIds(mockAlerts, [params.id]);
    return ok(null, '删除成功');
  }),
  mock(exceptionLogContract.testAlert, ({ params, ok }) => {
    const rule = requireItem(mockAlerts, params.id, '告警规则不存在', { status: 404 });
    mockAlertLogs.unshift({ id: nextIdFrom(mockAlertLogs), ruleId: rule.id, ruleName: rule.name, condition: rule.condition, detail: '这是一条测试告警消息，用于验证通知渠道配置是否可用', channels: rule.channels, source: 'test', createdAt: mockDateTime() });
    return ok(null, '测试消息已发送，请检查各通知渠道');
  }),
  mock(exceptionLogContract.alertLogs, ({ query, ok, paginate }) => ok(paginate(mockAlertLogs.filter((log) => matchesFilter(log.ruleId ?? undefined, query.ruleId))))),
];
