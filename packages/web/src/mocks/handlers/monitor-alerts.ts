import {
  MONITOR_ALERT_LEVELS,
  monitorAlertContract,
  type MonitorAlertEvent,
  type MonitorAlertHandleStatus,
  type MonitorAlertRule,
} from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockDateTime, mockDateTimeOffset } from '../utils/date';

/** N 分钟前的时间字符串 */
const minsAgo = (m: number) => mockDateTimeOffset(-m * 60 * 1000);

const rules: MonitorAlertRule[] = [
  {
    id: 1, name: 'CPU 使用率过高', metric: 'cpu', operator: 'gt', threshold: 85, durationMinutes: 5,
    level: 'warning', channels: ['inapp', 'email'], webhookUrl: null, recipientUserIds: [1], recipientEmails: ['ops@example.com'],
    silenceMinutes: 30, enabled: true, state: 'ok', lastTriggeredAt: minsAgo(120), lastValue: 23,
    createdAt: minsAgo(7 * 24 * 60), updatedAt: minsAgo(60),
  },
  {
    id: 2, name: '磁盘空间不足', metric: 'disk', operator: 'gte', threshold: 90, durationMinutes: 0,
    level: 'critical', channels: ['inapp', 'webhook'], webhookUrl: 'https://example.com/alert', recipientUserIds: [1], recipientEmails: [],
    silenceMinutes: 60, enabled: true, state: 'firing', lastTriggeredAt: minsAgo(15), lastValue: 92,
    createdAt: minsAgo(10 * 24 * 60), updatedAt: minsAgo(15),
  },
  {
    id: 3, name: '内存使用率告警', metric: 'memory', operator: 'gt', threshold: 80, durationMinutes: 3,
    level: 'warning', channels: ['inapp'], webhookUrl: null, recipientUserIds: [1], recipientEmails: [],
    silenceMinutes: 30, enabled: false, state: 'ok', lastTriggeredAt: null, lastValue: 41,
    createdAt: minsAgo(3 * 24 * 60), updatedAt: minsAgo(3 * 24 * 60),
  },
  {
    id: 4, name: '支付失败率飙升', metric: 'paymentFailureRate', operator: 'gte', threshold: 20, durationMinutes: 5,
    level: 'critical', channels: ['inapp', 'email'], webhookUrl: null, recipientUserIds: [1], recipientEmails: ['pay-oncall@example.com'],
    silenceMinutes: 30, enabled: true, state: 'firing', lastTriggeredAt: minsAgo(8), lastValue: 31.4,
    createdAt: minsAgo(20 * 24 * 60), updatedAt: minsAgo(8),
  },
  {
    id: 5, name: '对账差异待处理', metric: 'paymentReconDiff', operator: 'gte', threshold: 1, durationMinutes: 0,
    level: 'warning', channels: ['inapp'], webhookUrl: null, recipientUserIds: [1], recipientEmails: [],
    silenceMinutes: 720, enabled: true, state: 'firing', lastTriggeredAt: minsAgo(200), lastValue: 3,
    createdAt: minsAgo(20 * 24 * 60), updatedAt: minsAgo(200),
  },
  {
    id: 6, name: '支付事件派发积压', metric: 'paymentEventBacklog', operator: 'gte', threshold: 20, durationMinutes: 0,
    level: 'critical', channels: ['inapp', 'webhook'], webhookUrl: 'https://example.com/alert', recipientUserIds: [1], recipientEmails: [],
    silenceMinutes: 60, enabled: true, state: 'ok', lastTriggeredAt: null, lastValue: 2,
    createdAt: minsAgo(20 * 24 * 60), updatedAt: minsAgo(45),
  },
  {
    id: 7, name: '单应用错误率异常', metric: 'openApiAppErrorRate', operator: 'gte', threshold: 50, durationMinutes: 10,
    level: 'warning', channels: ['inapp'], webhookUrl: null, recipientUserIds: [1], recipientEmails: [],
    silenceMinutes: 60, enabled: true, state: 'ok', lastTriggeredAt: minsAgo(1440), lastValue: 12.5,
    createdAt: minsAgo(15 * 24 * 60), updatedAt: minsAgo(30),
  },
  {
    id: 8, name: '流程作业出现死信', metric: 'workflowDeadLetter', operator: 'gte', threshold: 1, durationMinutes: 0,
    level: 'warning', channels: [], webhookUrl: null, recipientUserIds: [], recipientEmails: [],
    silenceMinutes: 120, enabled: false, state: 'ok', lastTriggeredAt: null, lastValue: 0,
    createdAt: minsAgo(12 * 24 * 60), updatedAt: minsAgo(90),
  },
  {
    id: 9, name: '日志错误频率异常', metric: 'logErrorPerMin', operator: 'gte', threshold: 10, durationMinutes: 3,
    level: 'critical', channels: ['inapp'], webhookUrl: null, recipientUserIds: [1], recipientEmails: [],
    silenceMinutes: 30, enabled: true, state: 'firing', lastTriggeredAt: minsAgo(6), lastValue: 24.6,
    createdAt: minsAgo(10 * 24 * 60), updatedAt: minsAgo(6),
  },
];

const events: MonitorAlertEvent[] = [
  {
    id: 6, ruleId: 9, ruleName: '日志错误频率异常', metric: 'logErrorPerMin', level: 'critical', operator: 'gte',
    threshold: 10, value: 24.6, status: 'firing', message: '日志 ERROR 频率 当前 24.6 条/分钟，已满足条件 ≥ 10（持续 3 分钟）',
    notifyStatus: 'success', notifyChannels: ['inapp'], notifyError: null,
    notifiedAt: minsAgo(6),
    handleStatus: 'pending', acknowledgedAt: null, handledBy: null, handledByName: null,
    handledAt: null, handleNote: null,
    triggeredAt: minsAgo(6), resolvedAt: null,
  },
  {
    id: 5, ruleId: 4, ruleName: '支付失败率飙升', metric: 'paymentFailureRate', level: 'critical', operator: 'gte',
    threshold: 20, value: 31.4, status: 'firing', message: '支付失败率 当前 31.4%，已满足条件 ≥ 20%（持续 5 分钟）',
    notifyStatus: 'partial', notifyChannels: ['inapp', 'email'], notifyError: 'email: 邮件接收目标没有可用邮箱',
    notifiedAt: minsAgo(8),
    handleStatus: 'pending', acknowledgedAt: null, handledBy: null, handledByName: null,
    handledAt: null, handleNote: null,
    triggeredAt: minsAgo(8), resolvedAt: null,
  },
  {
    id: 4, ruleId: 5, ruleName: '对账差异待处理', metric: 'paymentReconDiff', level: 'warning', operator: 'gte',
    threshold: 1, value: 3, status: 'firing', message: '对账差异待处理 当前 3 项，已满足条件 ≥ 1 项',
    notifyStatus: 'success', notifyChannels: ['inapp'], notifyError: null,
    notifiedAt: minsAgo(200),
    handleStatus: 'acknowledged', acknowledgedAt: minsAgo(180), handledBy: 1, handledByName: '超级管理员',
    handledAt: minsAgo(180), handleNote: '已联系财务核对，等待渠道对账文件',
    triggeredAt: minsAgo(200), resolvedAt: null,
  },
  {
    id: 3, ruleId: 2, ruleName: '磁盘空间不足', metric: 'disk', level: 'critical', operator: 'gte',
    threshold: 90, value: 92, status: 'firing', message: '磁盘使用率 当前 92%，已满足条件 ≥ 90%',
    notifyStatus: 'failed', notifyChannels: ['inapp', 'webhook'],
    notifyError: 'webhook: 请求超时；inapp: 站内信接收人未匹配到任何启用用户',
    notifiedAt: minsAgo(15),
    handleStatus: 'pending', acknowledgedAt: null, handledBy: null, handledByName: null,
    handledAt: null, handleNote: null,
    triggeredAt: minsAgo(15), resolvedAt: null,
  },
  {
    id: 2, ruleId: 1, ruleName: 'CPU 使用率过高', metric: 'cpu', level: 'warning', operator: 'gt',
    threshold: 85, value: 88, status: 'resolved', message: 'CPU 使用率 当前 88%，已满足条件 > 85%（持续 5 分钟）',
    notifyStatus: 'success', notifyChannels: ['inapp', 'email'], notifyError: null,
    notifiedAt: minsAgo(110),
    handleStatus: 'closed', acknowledgedAt: minsAgo(115), handledBy: 1, handledByName: '超级管理员',
    handledAt: minsAgo(105), handleNote: '定时任务集中执行导致，已错峰',
    triggeredAt: minsAgo(120), resolvedAt: minsAgo(110),
  },
  {
    id: 1, ruleId: 7, ruleName: '单应用错误率异常', metric: 'openApiAppErrorRate', level: 'warning', operator: 'gte',
    threshold: 50, value: 63.2, status: 'resolved', message: '单应用最高错误率 当前 63.2%，已满足条件 ≥ 50%（持续 10 分钟）',
    notifyStatus: 'skipped', notifyChannels: [], notifyError: null,
    notifiedAt: null,
    handleStatus: 'pending', acknowledgedAt: null, handledBy: null, handledByName: null,
    handledAt: null, handleNote: null,
    triggeredAt: minsAgo(1440), resolvedAt: minsAgo(1400),
  },
];

/** 关闭规则所有未恢复事件，与服务端「停用即解除告警」的语义保持一致 */
function resolveRuleEvents(ruleId: number) {
  for (const event of events.filter((item) => item.ruleId === ruleId && item.status === 'firing')) {
    event.status = 'resolved';
    event.resolvedAt = mockDateTime();
  }
}

/** 与服务端 buildHandlePatch 同语义：acknowledgedAt 只写一次，撤销认领清空全部处理痕迹 */
function applyHandle(event: MonitorAlertEvent, handleStatus: MonitorAlertHandleStatus, note?: string | null) {
  if (handleStatus === 'pending') {
    event.handleStatus = 'pending';
    event.acknowledgedAt = null;
    event.handledBy = null;
    event.handledByName = null;
    event.handledAt = null;
    event.handleNote = null;
    return;
  }
  const now = mockDateTime();
  event.handleStatus = handleStatus;
  event.acknowledgedAt = event.acknowledgedAt ?? now;
  event.handledBy = 1;
  event.handledByName = '超级管理员';
  event.handledAt = now;
  event.handleNote = note?.trim() || event.handleNote;
}

/** N 分钟前的时间字符串转成「距今分钟数」，供概览统计复用 */
function minutesSince(value: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(value.replace(' ', 'T')).getTime()) / 60_000));
}

export const monitorAlertsHandlers = [
  mock(monitorAlertContract.overview, ({ query, ok }) => {
    const range = query.range ?? '24h';
    const days = range === '30d' ? 30 : range === '7d' ? 7 : 1;
    const sinceMinutes = days * 24 * 60;
    const inRange = events.filter((e) => minutesSince(e.triggeredAt) <= sinceMinutes);
    const firing = events.filter((e) => e.status === 'firing');
    const pending = firing.filter((e) => e.handleStatus === 'pending');
    const oldestPending = pending
      .map((e) => e.triggeredAt)
      .sort()[0] ?? null;

    const trendMap = new Map<string, { fired: number; resolved: number }>();
    for (const event of inRange) {
      const date = event.triggeredAt.slice(0, 10);
      const entry = trendMap.get(date) ?? { fired: 0, resolved: 0 };
      entry.fired += 1;
      if (event.status === 'resolved') entry.resolved += 1;
      trendMap.set(date, entry);
    }

    const ruleMap = new Map<string, { ruleId: number | null; ruleName: string; count: number }>();
    for (const event of inRange) {
      const entry = ruleMap.get(event.ruleName) ?? { ruleId: event.ruleId, ruleName: event.ruleName, count: 0 };
      entry.count += 1;
      ruleMap.set(event.ruleName, entry);
    }

    const acked = inRange.filter((e) => e.acknowledgedAt);
    const resolved = inRange.filter((e) => e.resolvedAt);
    const avg = (values: number[]) =>
      values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10;

    return ok({
      range,
      firingTotal: firing.length,
      firingByLevel: MONITOR_ALERT_LEVELS.map((level) => ({
        level,
        count: firing.filter((e) => e.level === level).length,
      })),
      pendingTotal: pending.length,
      oldestPendingAt: oldestPending,
      oldestPendingMinutes: oldestPending ? minutesSince(oldestPending) : null,
      firedInRange: inRange.length,
      resolvedInRange: inRange.filter((e) => e.status === 'resolved').length,
      notifyFailedInRange: inRange.filter((e) => ['partial', 'failed'].includes(e.notifyStatus)).length,
      mttaMinutes: avg(acked.map((e) => minutesSince(e.triggeredAt) - minutesSince(e.acknowledgedAt!))),
      mttrMinutes: avg(resolved.map((e) => minutesSince(e.triggeredAt) - minutesSince(e.resolvedAt!))),
      trend: [...trendMap.entries()]
        .map(([date, entry]) => ({ date, ...entry }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      topRules: [...ruleMap.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    }, 'success');
  }),

  mock(monitorAlertContract.events, ({ query, ok, paginate }) => {
    const keyword = query.keyword?.trim().toLowerCase();
    const { metric, level, status, notifyStatus, handleStatus, ruleId, startTime, endTime } = query;

    let filtered = [...events];
    if (keyword) {
      filtered = filtered.filter((e) =>
        e.ruleName.toLowerCase().includes(keyword) || e.message.toLowerCase().includes(keyword));
    }
    if (metric) filtered = filtered.filter((e) => e.metric === metric);
    if (level) filtered = filtered.filter((e) => e.level === level);
    if (status) filtered = filtered.filter((e) => e.status === status);
    if (notifyStatus) filtered = filtered.filter((e) => e.notifyStatus === notifyStatus);
    if (handleStatus) filtered = filtered.filter((e) => e.handleStatus === handleStatus);
    if (ruleId) filtered = filtered.filter((e) => e.ruleId === ruleId);
    // 时间范围为闭区间，与服务端 dateRangeConditions 一致
    if (startTime) filtered = filtered.filter((e) => e.triggeredAt >= startTime);
    if (endTime) filtered = filtered.filter((e) => e.triggeredAt <= endTime);
    return ok(paginate(filtered), 'success');
  }),

  // 批量必须先于 `/events/{id}/handle` 注册，否则 batch 会被当成事件 id
  mock(monitorAlertContract.handleEventsBatch, ({ body, ok }) => {
    const { ids, handleStatus, note } = body;
    let count = 0;
    for (const event of events.filter((e) => ids.includes(e.id))) {
      applyHandle(event, handleStatus, note);
      count += 1;
    }
    return ok(null, `已处理 ${count} 条告警`);
  }),

  mock(monitorAlertContract.handleEvent, ({ params, body, ok }) => {
    const event = events.find((e) => e.id === params.id);
    if (!event) return notFound('告警事件不存在', { status: 404 });
    applyHandle(event, body.handleStatus, body.note);
    return ok(event, '操作成功');
  }),

  mock(monitorAlertContract.list, ({ query, ok, paginate }) => {
    const keyword = query.keyword?.trim().toLowerCase();
    const { metric, level, enabled, state } = query;

    let filtered = [...rules];
    if (keyword) filtered = filtered.filter((r) => r.name.toLowerCase().includes(keyword));
    if (metric) filtered = filtered.filter((r) => r.metric === metric);
    if (level) filtered = filtered.filter((r) => r.level === level);
    if (enabled !== undefined) filtered = filtered.filter((r) => r.enabled === enabled);
    if (state) filtered = filtered.filter((r) => r.state === state);
    return ok(paginate(filtered), 'success');
  }),

  mock(monitorAlertContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const rule: MonitorAlertRule = {
      id: nextIdFrom(rules), name: body.name, metric: body.metric, operator: body.operator,
      threshold: body.threshold, durationMinutes: body.durationMinutes, level: body.level,
      channels: body.channels, webhookUrl: body.webhookUrl ?? null,
      recipientUserIds: body.recipientUserIds, recipientEmails: body.recipientEmails,
      silenceMinutes: body.silenceMinutes, enabled: body.enabled, state: 'ok',
      lastTriggeredAt: null, lastValue: null, createdAt: now, updatedAt: now,
    };
    rules.unshift(rule);
    return ok(rule, '创建成功');
  }),

  // 批量路由必须先于 `/{id}` 注册，否则会被匹配成 id="batch"
  mock(monitorAlertContract.setEnabledBatch, ({ body, ok }) => {
    const { ids, enabled } = body;
    let count = 0;
    for (const rule of rules.filter((r) => ids.includes(r.id))) {
      rule.enabled = enabled;
      rule.state = 'ok';
      rule.updatedAt = mockDateTime();
      resolveRuleEvents(rule.id);
      count += 1;
    }
    return ok(null, `已${enabled ? '启用' : '停用'} ${count} 条规则`);
  }),

  mock(monitorAlertContract.removeBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    removeWhere(rules, (r) => ids.has(r.id));
    return ok(null, '删除成功');
  }),

  mock(monitorAlertContract.test, ({ params, ok }) => {
    const rule = rules.find((r) => r.id === params.id);
    if (!rule) return notFound('告警规则不存在', { status: 404 });
    const channels = rule.channels ?? [];
    if (channels.length === 0) {
      return ok({ status: 'skipped', channels: [], error: null }, '测试通知已发送');
    }
    // Demo 下模拟一次真实的部分失败，让「通知状态」的分级展示在演示中可见
    const failing = channels.includes('webhook') ? ['webhook'] : [];
    return ok({
      status: failing.length === 0 ? 'success' : failing.length === channels.length ? 'failed' : 'partial',
      channels,
      error: failing.length === 0 ? null : 'webhook: 演示环境不会真实外呼',
    }, '测试通知已发送');
  }),

  mock(monitorAlertContract.update, ({ params, body, ok }) => {
    const rule = rules.find((r) => r.id === params.id);
    if (!rule) return notFound('告警规则不存在', { status: 404 });
    Object.assign(rule, body, { updatedAt: mockDateTime() });
    if (body.enabled === false) {
      rule.state = 'ok';
      resolveRuleEvents(params.id);
    }
    return ok(rule, '更新成功');
  }),

  mock(monitorAlertContract.setEnabled, ({ params, body, ok }) => {
    const rule = rules.find((r) => r.id === params.id);
    if (!rule) return notFound('告警规则不存在', { status: 404 });
    rule.enabled = body.enabled;
    if (!body.enabled) {
      rule.state = 'ok';
      resolveRuleEvents(params.id);
    }
    rule.updatedAt = mockDateTime();
    return ok(rule, '操作成功');
  }),

  mock(monitorAlertContract.remove, ({ params, ok }) => {
    const idx = rules.findIndex((r) => r.id === params.id);
    if (idx >= 0) rules.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
