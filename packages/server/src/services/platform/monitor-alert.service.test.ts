import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitorAlertRuleRow } from '../../db/schema';
import { monitorAlertEvents, monitorAlertRules } from '../../db/schema';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../db', () => {
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    // 单条规则响应要带上派生的事件数，走 $count；用例只关心事件关闭语义，统一给 0
    $count: vi.fn(),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return { db };
});

vi.mock('../../lib/tenant', () => ({
  tenantScope: vi.fn(() => undefined),
  currentCreateTenantId: vi.fn(() => null),
}));

vi.mock('../../lib/pg-boss-scheduler', () => ({
  countActiveWorkerNodes: vi.fn(),
}));

vi.mock('../../lib/alert-dispatch', () => ({
  dispatchAlertChannels: vi.fn(),
  enqueueAlertWithin: vi.fn(),
  dispatchQueuedAlert: vi.fn(),
}));

vi.mock('../../lib/context', () => ({
  currentUserId: vi.fn(() => 42),
  currentUsername: vi.fn(() => 'ops'),
}));

import { db } from '../../db';
import { evaluateMonitorAlerts, handleEvent, setRuleEnabled, setRulesEnabled, updateRule } from './monitor-alert.service';
import { registerMonitorMetricSource } from './monitor-alert-metrics';
import { countActiveWorkerNodes } from '../../lib/pg-boss-scheduler';
import { dispatchQueuedAlert, enqueueAlertWithin } from '../../lib/alert-dispatch';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit', 'set', 'returning', 'for', 'orderBy']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function alertRule(overrides: Partial<MonitorAlertRuleRow> = {}): MonitorAlertRuleRow {
  return {
    id: 7,
    tenantId: null,
    name: 'CPU 使用率过高',
    metric: 'cpu',
    operator: 'gte',
    threshold: 85,
    durationMinutes: 5,
    level: 'warning',
    channels: ['inapp'],
    webhookUrl: null,
    recipientUserIds: [1],
    recipientEmails: [],
    silenceMinutes: 30,
    enabled: true,
    state: 'firing',
    breachingSince: new Date('2026-08-12T08:00:00Z'),
    lastTriggeredAt: new Date('2026-08-12T08:05:00Z'),
    lastValue: 92,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-08-12T07:00:00Z'),
    updatedAt: new Date('2026-08-12T08:05:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.$count.mockResolvedValue(0);
});

describe('setRuleEnabled', () => {
  it('停用规则时原子关闭未恢复事件并清除运行态', async () => {
    const current = alertRule();
    const updated = alertRule({ enabled: false, state: 'ok', breachingSince: null });
    const ruleUpdate = createChain([updated]);
    const eventUpdate = createChain([]);

    dbMock.select.mockReturnValueOnce(createChain([current]));
    dbMock.update
      .mockReturnValueOnce(ruleUpdate)
      .mockReturnValueOnce(eventUpdate);

    const result = await setRuleEnabled(current.id, false);

    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(dbMock.update).toHaveBeenNthCalledWith(1, monitorAlertRules);
    expect(ruleUpdate.set).toHaveBeenCalledWith({ enabled: false, state: 'ok', breachingSince: null });
    expect(dbMock.update).toHaveBeenNthCalledWith(2, monitorAlertEvents);
    expect(eventUpdate.set).toHaveBeenCalledWith({
      status: 'resolved',
      resolvedAt: expect.any(Date),
    });
    expect(result).toMatchObject({ enabled: false, state: 'ok' });
  });

  it('重复启用正在运行的规则时不清除现有告警', async () => {
    const current = alertRule();
    dbMock.select
      .mockReturnValueOnce(createChain([current]))
      .mockReturnValueOnce(createChain([{ id: 1, email: 'admin@zenith.dev' }]));

    const result = await setRuleEnabled(current.id, true);

    expect(dbMock.transaction).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ enabled: true, state: 'firing' });
  });

  it('启用规则时拒绝不存在、停用或跨租户的接收用户', async () => {
    const current = alertRule({ enabled: false, state: 'ok' });
    dbMock.select
      .mockReturnValueOnce(createChain([current]))
      .mockReturnValueOnce(createChain([]));

    await expect(setRuleEnabled(current.id, true)).rejects.toMatchObject({
      message: '接收用户不存在、已停用或不属于当前租户',
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('邮件渠道要求所选用户至少有一个可用邮箱或配置额外邮箱', async () => {
    const current = alertRule({
      enabled: false,
      state: 'ok',
      channels: ['email'],
      recipientUserIds: [2],
      recipientEmails: [],
    });
    dbMock.select
      .mockReturnValueOnce(createChain([current]))
      .mockReturnValueOnce(createChain([{ id: 2, email: null }]));

    await expect(setRuleEnabled(current.id, true)).rejects.toMatchObject({
      message: '所选用户均未配置邮箱，请选择有邮箱的用户或填写额外邮箱',
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

describe('setRulesEnabled', () => {
  it('批量停用时一次性关闭所有选中规则的未恢复事件', async () => {
    const first = alertRule({ id: 7 });
    const second = alertRule({ id: 8 });
    const ruleUpdate = createChain([{ id: 7 }, { id: 8 }]);
    const eventUpdate = createChain([]);

    dbMock.select
      .mockReturnValueOnce(createChain([first]))
      .mockReturnValueOnce(createChain([second]));
    dbMock.update
      .mockReturnValueOnce(ruleUpdate)
      .mockReturnValueOnce(eventUpdate);

    const count = await setRulesEnabled([7, 8], false);

    expect(count).toBe(2);
    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(ruleUpdate.set).toHaveBeenCalledWith({ enabled: false, state: 'ok', breachingSince: null });
    expect(eventUpdate.set).toHaveBeenCalledWith({ status: 'resolved', resolvedAt: expect.any(Date) });
  });

  it('批量启用时整批拒绝：任一规则投递配置不全都不放行', async () => {
    // 第二条规则勾了站内信却没有接收人，放行会让它每轮评估都「触发了但没人收到」
    const valid = alertRule({ id: 7 });
    const invalid = alertRule({ id: 8, enabled: false, state: 'ok', recipientUserIds: [] });

    dbMock.select
      .mockReturnValueOnce(createChain([valid]))
      .mockReturnValueOnce(createChain([invalid]))
      .mockReturnValueOnce(createChain([{ id: 1, email: 'admin@zenith.dev' }]));

    await expect(setRulesEnabled([7, 8], true)).rejects.toMatchObject({
      message: '站内信渠道必须选择接收用户',
    });
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.transaction).not.toHaveBeenCalled();
  });
});

describe('updateRule', () => {
  it('通过编辑表单停用规则时同样关闭未恢复事件', async () => {
    const current = alertRule();
    const updated = alertRule({ enabled: false, state: 'ok', breachingSince: null });
    const ruleUpdate = createChain([updated]);
    const eventUpdate = createChain([]);

    dbMock.select.mockReturnValueOnce(createChain([current]));
    dbMock.update
      .mockReturnValueOnce(ruleUpdate)
      .mockReturnValueOnce(eventUpdate);

    const result = await updateRule(current.id, { enabled: false });

    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(ruleUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      state: 'ok',
      breachingSince: null,
    }));
    expect(eventUpdate.set).toHaveBeenCalledWith({
      status: 'resolved',
      resolvedAt: expect.any(Date),
    });
    expect(result).toMatchObject({ enabled: false, state: 'ok' });
  });
});

describe('handleEvent', () => {
  function alertEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: 11,
      tenantId: null,
      ruleId: 7,
      ruleName: 'CPU 使用率过高',
      metric: 'cpu',
      level: 'warning',
      operator: 'gte',
      threshold: 85,
      value: 92,
      status: 'firing',
      message: 'CPU 使用率 当前 92%',
      notifyStatus: 'success',
      notifyChannels: ['inapp'],
      notifyError: null,
      notifiedAt: new Date('2026-08-12T08:05:00Z'),
      handleStatus: 'pending',
      acknowledgedAt: null,
      handledBy: null,
      handledAt: null,
      handleNote: null,
      triggeredAt: new Date('2026-08-12T08:00:00Z'),
      resolvedAt: null,
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('认领时写入首次确认时间与处理人', async () => {
    const current = alertEvent();
    const update = createChain([alertEvent({ handleStatus: 'acknowledged', handledBy: 42 })]);
    dbMock.select.mockReturnValueOnce(createChain([current]));
    dbMock.update.mockReturnValueOnce(update);

    await handleEvent(current.id, { handleStatus: 'acknowledged', note: '  排查中  ' });

    expect(update.set).toHaveBeenCalledWith({
      handleStatus: 'acknowledged',
      acknowledgedAt: expect.any(Date),
      handledBy: 42,
      handledAt: expect.any(Date),
      handleNote: '排查中',
    });
  });

  it('关闭时保留首次确认时间：它是 MTTA 的分子，被覆盖会让确认耗时失真', async () => {
    const acknowledgedAt = new Date('2026-08-12T08:03:00Z');
    const current = alertEvent({ handleStatus: 'acknowledged', acknowledgedAt, handledBy: 7 });
    const update = createChain([alertEvent({ handleStatus: 'closed' })]);
    dbMock.select.mockReturnValueOnce(createChain([current]));
    dbMock.update.mockReturnValueOnce(update);

    await handleEvent(current.id, { handleStatus: 'closed' });

    expect(update.set).toHaveBeenCalledWith(expect.objectContaining({
      handleStatus: 'closed',
      acknowledgedAt,
    }));
  });

  it('直接关闭未认领的告警时同样计入一次响应', async () => {
    const current = alertEvent();
    const update = createChain([alertEvent({ handleStatus: 'closed' })]);
    dbMock.select.mockReturnValueOnce(createChain([current]));
    dbMock.update.mockReturnValueOnce(update);

    await handleEvent(current.id, { handleStatus: 'closed' });

    expect(update.set).toHaveBeenCalledWith(expect.objectContaining({
      handleStatus: 'closed',
      acknowledgedAt: expect.any(Date),
    }));
  });

  it('撤销认领清空全部处理痕迹，让告警回到待处理池', async () => {
    const current = alertEvent({
      handleStatus: 'acknowledged',
      acknowledgedAt: new Date('2026-08-12T08:03:00Z'),
      handledBy: 7,
      handleNote: '排查中',
    });
    const update = createChain([alertEvent()]);
    dbMock.select.mockReturnValueOnce(createChain([current]));
    dbMock.update.mockReturnValueOnce(update);

    await handleEvent(current.id, { handleStatus: 'pending' });

    expect(update.set).toHaveBeenCalledWith({
      handleStatus: 'pending',
      acknowledgedAt: null,
      handledBy: null,
      handledAt: null,
      handleNote: null,
    });
  });
});

describe('evaluateMonitorAlerts', () => {
  const cpu = vi.fn(() => ({ cpu: 10 }));
  const job = vi.fn(() => ({ jobsStuck: 0 }));
  const backlog = vi.fn(() => ({}));
  registerMonitorMetricSource({ scope: 'global', metrics: ['cpu'], read: cpu });
  registerMonitorMetricSource({ scope: 'global', metrics: ['jobsStuck'], read: job });
  registerMonitorMetricSource({ scope: 'global', metrics: ['schedulerQueueBacklog'], read: backlog });
  registerMonitorMetricSource({
    scope: 'global', metrics: ['schedulerWorkerNodes'], read: async () => ({ schedulerWorkerNodes: await countActiveWorkerNodes() }),
  });

  const workerRule = alertRule({
    id: 19, metric: 'schedulerWorkerNodes', operator: 'lt', threshold: 1, durationMinutes: 0,
    state: 'ok', breachingSince: null, lastTriggeredAt: null,
  });

  it('keeps the current alarm state when a source fails', async () => {
    dbMock.select.mockReturnValueOnce(createChain([alertRule({ metric: 'jobsStuck' })]));
    job.mockImplementationOnce(() => { throw new Error('queue unavailable'); });

    expect(await evaluateMonitorAlerts()).toEqual({ evaluated: 0, fired: 0, resolved: 0 });
    expect(dbMock.transaction).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(enqueueAlertWithin).not.toHaveBeenCalled();
  });

  it('leaves missing observations unevaluated', async () => {
    dbMock.select.mockReturnValueOnce(createChain([alertRule({ metric: 'schedulerQueueBacklog' })]));

    expect(await evaluateMonitorAlerts()).toEqual({ evaluated: 0, fired: 0, resolved: 0 });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('only reads the Worker source for the watchdog and enqueues its zero-heartbeat alert inside the transaction', async () => {
    const selection = createChain([workerRule]);
    dbMock.select.mockReturnValueOnce(selection).mockReturnValueOnce(createChain([workerRule]));
    vi.mocked(countActiveWorkerNodes).mockResolvedValue(0);
    const insertValues = vi.fn(() => createChain([{ id: 501 }]));
    dbMock.insert.mockReturnValue({ values: insertValues } as never);
    dbMock.update.mockReturnValue(createChain([]));
    const notification = { status: 'success', channels: ['inapp'], error: null } as const;
    vi.mocked(enqueueAlertWithin).mockResolvedValue({ outboxId: 8, channels: ['inapp'], logTag: 'MonitorAlert' });
    vi.mocked(dispatchQueuedAlert).mockResolvedValue({ ...notification, channels: [...notification.channels] });

    expect(await evaluateMonitorAlerts({ workerWatchdog: true })).toEqual({ evaluated: 1, fired: 1, resolved: 0 });

    expect(new PgDialect().sqlToQuery(selection.where.mock.calls[0][0]).params).toContain('schedulerWorkerNodes');
    expect(cpu).not.toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
    expect(backlog).not.toHaveBeenCalled();
    expect(countActiveWorkerNodes).toHaveBeenNthCalledWith(2, db);
    expect(insertValues.mock.calls[0][0]).toMatchObject({ ruleId: 19, metric: 'schedulerWorkerNodes', value: 0, status: 'firing' });
    expect(enqueueAlertWithin).toHaveBeenCalledWith(db, expect.objectContaining({ tenantId: null }), expect.objectContaining({
      eventKey: 'ops.monitor.alert',
      dedupeKey: expect.stringContaining('monitor-alert:19:501:fired:'),
    }));
    expect(dispatchQueuedAlert).toHaveBeenCalledOnce();
  });

  it('leaves recovery to the Worker when heartbeat returns after watchdog collection', async () => {
    dbMock.select.mockReturnValueOnce(createChain([workerRule])).mockReturnValueOnce(createChain([workerRule]));
    vi.mocked(countActiveWorkerNodes).mockResolvedValueOnce(0).mockResolvedValueOnce(2);

    expect(await evaluateMonitorAlerts({ workerWatchdog: true })).toEqual({ evaluated: 0, fired: 0, resolved: 0 });
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('uses the current locked state when another evaluator already raised the alert', async () => {
    dbMock.select.mockReturnValueOnce(createChain([workerRule])).mockReturnValueOnce(createChain([
      { ...workerRule, state: 'firing', lastTriggeredAt: new Date() },
    ]));
    vi.mocked(countActiveWorkerNodes).mockResolvedValue(0);
    dbMock.update.mockReturnValue(createChain([]));

    expect(await evaluateMonitorAlerts({ workerWatchdog: true })).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(enqueueAlertWithin).not.toHaveBeenCalled();
  });

  it('evaluates all available rules and skips only the unavailable source', async () => {
    const cpuRule = alertRule({ metric: 'cpu', state: 'ok', breachingSince: null });
    dbMock.select.mockReturnValueOnce(createChain([cpuRule, alertRule({ metric: 'jobsStuck' }), workerRule]))
      .mockReturnValueOnce(createChain([cpuRule]))
      .mockReturnValueOnce(createChain([workerRule]));
    job.mockImplementationOnce(() => { throw new Error('queue unavailable'); });
    vi.mocked(countActiveWorkerNodes).mockResolvedValue(2);
    dbMock.update.mockReturnValue(createChain([]));

    expect(await evaluateMonitorAlerts()).toEqual({ evaluated: 2, fired: 0, resolved: 0 });
  });
});
