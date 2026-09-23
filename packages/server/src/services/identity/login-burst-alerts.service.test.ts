/**
 * 登录失败突增告警派发服务单测。
 *
 * 守卫负责阈值判定与去重（见 lib/login-challenge-guard.test.ts），本服务只做两件事：
 *   1. 按租户解析接收人：身份安全策略管理员 / 登录风险查看者 + 平台超管，启用账号去重合并；
 *   2. 交给通知派发层（notify），无接收人或派发失败只记日志，绝不抛出到登录流程。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoginFailureOutcome } from '../../lib/login-challenge-guard';

const state = vi.hoisted(() => ({
  /** 每次 db.selectDistinct(...) 链的最终 where 结果，按调用顺序消费 */
  results: [] as unknown[][],
}));

vi.mock('../../db', () => ({
  db: {
    selectDistinct: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.innerJoin = () => chain;
      chain.where = () => Promise.resolve(state.results.shift() ?? []);
      return chain;
    }),
  },
}));
vi.mock('../messaging/notification-outbox.service', () => ({
  notify: vi.fn(async () => ({ id: 1 })),
}));
vi.mock('../../lib/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { notify } from '../messaging/notification-outbox.service';
import logger from '../../lib/logger';
import { dispatchLoginBurstAlerts, resolveLoginAlertUserIds } from './login-burst-alerts.service';

const CTX = { username: 'alice', ip: '1.1.1.1', tenantId: 7, windowMinutes: 30, link: '/system/login-logs' };

function outcome(bursts: LoginFailureOutcome['bursts'], overrides: Partial<LoginFailureOutcome> = {}): LoginFailureOutcome {
  return { remaining: 0, sourceCount: 4, failureCount: 62, bursts, ...overrides };
}

beforeEach(() => {
  state.results = [];
  vi.mocked(notify).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe('resolveLoginAlertUserIds', () => {
  it('合并权限命中用户与平台超管并去重', async () => {
    state.results = [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]];
    expect(await resolveLoginAlertUserIds(7)).toEqual([1, 2, 3]);
  });
});

describe('dispatchLoginBurstAlerts', () => {
  it('无突增信号时不查接收人、不派发', async () => {
    await dispatchLoginBurstAlerts(outcome([]), CTX);
    expect(notify).not.toHaveBeenCalled();
    expect(state.results).toEqual([]);
  });

  it('多来源告警带上统计、深链与按窗口桶去重的 dedupeKey', async () => {
    state.results = [[{ id: 1 }], []];
    await dispatchLoginBurstAlerts(outcome(['multi-source']), CTX);

    expect(notify).toHaveBeenCalledTimes(1);
    const [eventKey, payload] = vi.mocked(notify).mock.calls[0];
    expect(eventKey).toBe('identity.login.burst_alert');
    expect(payload).toMatchObject({
      recipients: [{ type: 'user', id: 1 }],
      tenantId: 7,
      link: '/system/login-logs',
      vars: {
        username: 'alice',
        kindLabel: '多来源尝试（疑似分布式猜解）',
        failureCount: 62,
        sourceCount: 4,
        windowMinutes: 30,
        ip: '1.1.1.1',
      },
    });
    expect(payload.dedupeKey).toMatch(/^login-burst:multi-source:7:alice:\d+$/);
  });

  it('两种原因各派发一条，平台账号落在 platform 桶', async () => {
    state.results = [[{ id: 1 }], []];
    await dispatchLoginBurstAlerts(outcome(['multi-source', 'high-volume']), { ...CTX, tenantId: null });

    expect(notify).toHaveBeenCalledTimes(2);
    const keys = vi.mocked(notify).mock.calls.map(([, payload]) => payload.dedupeKey);
    expect(keys[0]).toContain('login-burst:multi-source:platform:alice:');
    expect(keys[1]).toContain('login-burst:high-volume:platform:alice:');
    expect(vi.mocked(notify).mock.calls[1][1].vars.kindLabel).toBe('失败量异常（疑似口令爆破）');
  });

  it('没有接收人时记日志而不派发', async () => {
    state.results = [[], []];
    await dispatchLoginBurstAlerts(outcome(['multi-source']), CTX);

    expect(notify).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('派发失败只记日志，不向登录流程抛错', async () => {
    state.results = [[{ id: 1 }], []];
    vi.mocked(notify).mockRejectedValueOnce(new Error('outbox down'));

    await expect(dispatchLoginBurstAlerts(outcome(['high-volume']), CTX)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
