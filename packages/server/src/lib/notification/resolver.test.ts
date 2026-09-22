/**
 * 偏好解析引擎的决策矩阵测试。
 *
 * 这一层决定「谁在哪个渠道上收得到」，出错的表现是通知悄悄消失或悄悄多发，
 * 两者在生产上都很难被发现，因此优先级顺序与免打扰边界必须逐条锁住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({
  db: { select: vi.fn() },
}));

vi.mock('./registry', () => ({
  hasNotificationAdapter: vi.fn(),
}));

import type { NotificationEventDef } from '@zenith/shared/messaging';
import { db } from '../../db';
import { hasNotificationAdapter } from './registry';
import { resolveDispatchPlan } from './resolver';

const dbMock = vi.mocked(db);
const hasAdapterMock = vi.mocked(hasNotificationAdapter);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSelectChain(result: unknown[]): any {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** 依次喂给 loadOverrides / preferences / settings 三次查询 */
function mockQueries(overrides: unknown[], preferences: unknown[], settings: unknown[]): void {
  dbMock.select
    .mockReturnValueOnce(createSelectChain(overrides))
    .mockReturnValueOnce(createSelectChain(preferences))
    .mockReturnValueOnce(createSelectChain(settings));
}

const baseEvent: NotificationEventDef = {
  group: 'wiki',
  label: '测试事件',
  severity: 'normal',
  defaultChannels: ['inapp'],
  availableChannels: ['inapp', 'email'],
  vars: {},
  title: '标题',
  content: '正文',
};

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    recipientType: 'user',
    recipientId: 1,
    globalMuted: false,
    timezone: 'Asia/Shanghai',
    quietStart: null,
    quietEnd: null,
    digestMode: 'realtime',
    digestHour: 9,
    ...overrides,
  };
}

function resolve(event: NotificationEventDef, options: Parameters<typeof resolveDispatchPlan>[0]['policy'] = null, now?: Date) {
  return resolveDispatchPlan({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventKey: 'wiki.doc.commented' as any,
    event,
    recipients: [{ type: 'user', id: 1 }],
    tenantId: 10,
    policy: options,
    now,
  });
}

function channelOf(plan: Awaited<ReturnType<typeof resolveDispatchPlan>>, channel: string) {
  return plan[0].channels.find((item) => item.channel === channel);
}

beforeEach(() => {
  vi.resetAllMocks();
  hasAdapterMock.mockReturnValue(true);
});

describe('resolveDispatchPlan 渠道优先级', () => {
  it('honors a completed guarded-watch digest window while retaining mute and channel preferences', async () => {
    const input = { eventKey: 'platform.entity.changed' as const, event: baseEvent, recipients: [{ type: 'user' as const, id: 1 }],
      tenantId: 10, policy: { only: ['email' as const] }, digestWindowElapsed: true };
    mockQueries([], [], [settingsRow({ digestMode: 'hourly' })]);
    expect(channelOf(await resolveDispatchPlan(input), 'email')).toMatchObject({ allowed: true });
    mockQueries([], [], [settingsRow({ digestMode: 'hourly', globalMuted: true })]);
    expect(channelOf(await resolveDispatchPlan(input), 'email')).toMatchObject({ allowed: false, reasonCode: 'globally_muted' });
    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: false }], [settingsRow({ digestMode: 'hourly' })]);
    expect(channelOf(await resolveDispatchPlan(input), 'email')).toMatchObject({ allowed: false, reasonCode: 'preference_off' });
  });
  it('无任何覆盖时按事件默认渠道投递，非默认的可选渠道保持关闭', async () => {
    mockQueries([], [], []);
    const plan = await resolve(baseEvent);
    expect(channelOf(plan, 'inapp')).toMatchObject({ allowed: true, reasonCode: null });
    expect(channelOf(plan, 'email')).toMatchObject({ allowed: false, reasonCode: 'preference_off' });
  });

  it('用户偏好可以关闭默认渠道，也可以打开非默认渠道', async () => {
    mockQueries([], [
      { recipientType: 'user', recipientId: 1, channel: 'inapp', enabled: false },
      { recipientType: 'user', recipientId: 1, channel: 'email', enabled: true },
    ], []);
    const plan = await resolve(baseEvent);
    expect(channelOf(plan, 'inapp')).toMatchObject({ allowed: false, reasonCode: 'preference_off' });
    expect(channelOf(plan, 'email')).toMatchObject({ allowed: true });
  });

  it('mandatory 事件忽略用户偏好，强制投递', async () => {
    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'inapp', enabled: false }], []);
    const plan = await resolve({ ...baseEvent, mandatory: true });
    expect(channelOf(plan, 'inapp')).toMatchObject({ allowed: true });
  });

  it('租户覆盖 locked 时压过用户偏好；未 locked 时用户偏好优先', async () => {
    mockQueries(
      [{ tenantId: 10, channel: 'email', enabled: true, locked: true }],
      [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: false }],
      [],
    );
    expect(channelOf(await resolve(baseEvent), 'email')).toMatchObject({ allowed: true });

    mockQueries(
      [{ tenantId: 10, channel: 'email', enabled: true, locked: false }],
      [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: false }],
      [],
    );
    expect(channelOf(await resolve(baseEvent), 'email')).toMatchObject({ allowed: false, reasonCode: 'preference_off' });
  });

  it('租户级覆盖优先于平台级覆盖', async () => {
    mockQueries([
      { tenantId: null, channel: 'email', enabled: false, locked: false },
      { tenantId: 10, channel: 'email', enabled: true, locked: false },
    ], [], []);
    expect(channelOf(await resolve(baseEvent), 'email')).toMatchObject({ allowed: true });
  });

  it('未注册适配器的渠道记为 channel_unavailable 而不是静默丢弃', async () => {
    hasAdapterMock.mockImplementation((channel) => channel !== 'email');
    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: true }], []);
    expect(channelOf(await resolve(baseEvent), 'email')).toMatchObject({
      allowed: false,
      reasonCode: 'channel_unavailable',
    });
  });
});

describe('resolveDispatchPlan 免打扰与全局静音', () => {
  it('全局静音抑制普通事件，但拦不住 mandatory 事件', async () => {
    mockQueries([], [], [settingsRow({ globalMuted: true })]);
    expect(channelOf(await resolve(baseEvent), 'inapp')).toMatchObject({
      allowed: false,
      reasonCode: 'globally_muted',
    });

    mockQueries([], [], [settingsRow({ globalMuted: true })]);
    expect(channelOf(await resolve({ ...baseEvent, mandatory: true }), 'inapp')).toMatchObject({ allowed: true });
  });

  it('免打扰时段内延后外发渠道，站内信照常落库', async () => {
    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: true }], [
      settingsRow({ quietStart: '22:00', quietEnd: '08:00', timezone: 'UTC' }),
    ]);
    // UTC 23:30 落在 22:00–08:00 的跨零点窗口内
    const plan = await resolve(baseEvent, null, new Date('2026-08-18T23:30:00Z'));
    const email = channelOf(plan, 'email');
    expect(email).toMatchObject({ allowed: false, reasonCode: 'quiet_hours' });
    // 距离 08:00 还有 8.5 小时
    expect(email?.deferUntil?.toISOString()).toBe('2026-08-19T08:00:00.000Z');
    expect(channelOf(plan, 'inapp')).toMatchObject({ allowed: true });
  });

  it('critical 事件穿透免打扰', async () => {
    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: true }], [
      settingsRow({ quietStart: '22:00', quietEnd: '08:00', timezone: 'UTC' }),
    ]);
    const plan = await resolve(
      { ...baseEvent, severity: 'critical' },
      null,
      new Date('2026-08-18T23:30:00Z'),
    );
    expect(channelOf(plan, 'email')).toMatchObject({ allowed: true });
  });

  it('免打扰窗口外不做延后', async () => {
    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'email', enabled: true }], [
      settingsRow({ quietStart: '22:00', quietEnd: '08:00', timezone: 'UTC' }),
    ]);
    const plan = await resolve(baseEvent, null, new Date('2026-08-18T12:00:00Z'));
    expect(channelOf(plan, 'email')).toMatchObject({ allowed: true, deferUntil: null });
  });
});

describe('resolveDispatchPlan 渠道策略与外部收件人', () => {
  it('policy.only 收窄候选渠道，policy.disable 强制关闭', async () => {
    mockQueries([], [], []);
    const onlyPlan = await resolve(baseEvent, { only: ['email'] });
    expect(onlyPlan[0].channels.map((item) => item.channel)).toEqual(['email']);
    expect(channelOf(onlyPlan, 'email')).toMatchObject({ allowed: true });

    mockQueries([], [{ recipientType: 'user', recipientId: 1, channel: 'inapp', enabled: true }], []);
    expect(channelOf(await resolve(baseEvent, { disable: ['inapp'] }), 'inapp')).toBeUndefined();
  });

  it('policy.enable 打开非默认渠道', async () => {
    mockQueries([], [], []);
    expect(channelOf(await resolve(baseEvent, { enable: ['email'] }), 'email')).toMatchObject({ allowed: true });
  });

  it('external 收件人跳过偏好，只在自身渠道上投递', async () => {
    dbMock.select.mockReturnValueOnce(createSelectChain([]));
    const plan = await resolveDispatchPlan({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventKey: 'wiki.doc.commented' as any,
      event: baseEvent,
      recipients: [{ type: 'external', channel: 'email', address: 'ops@example.com' }],
      tenantId: null,
      policy: null,
    });
    expect(plan[0].channels.find((item) => item.channel === 'email')).toMatchObject({ allowed: true });
    expect(plan[0].channels.find((item) => item.channel === 'inapp')).toMatchObject({ allowed: false });
  });
});
