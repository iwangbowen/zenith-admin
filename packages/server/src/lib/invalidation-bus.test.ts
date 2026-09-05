/**
 * 跨实例缓存失效总线单测。
 *
 * 覆盖要点：
 *  1. 建立监听后状态为 listening，onlisten 回调触发全量 reset
 *  2. 收到 payload 按 topic 分发；畸形 payload 忽略且不抛
 *  3. 监听建立失败 → degraded，不抛出，定时重试；重试成功后转为 listening
 *  4. 同一进程只启动一次
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listenMock, logger } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db', () => ({ pgClient: { listen: listenMock } }));
vi.mock('./logger', () => ({ default: logger }));

import {
  dispatchInvalidation,
  invalidationBusState,
  onInvalidate,
  onInvalidationReset,
  resetInvalidationBusForTest,
  startInvalidationBus,
} from './invalidation-bus';

type Listen = (channel: string, onnotify: (payload: string) => void, onlisten: () => void) => Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  resetInvalidationBusForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('invalidation bus', () => {
  it('建立监听后 listening，onlisten 触发全量 reset，通知按 topic 分发', async () => {
    let notify: ((payload: string) => void) | undefined;
    (listenMock as unknown as { mockImplementation: (fn: Listen) => void }).mockImplementation(async (_channel, onnotify, onlisten) => {
      notify = onnotify;
      onlisten();
      return { state: 'ok' };
    });
    const reset = vi.fn();
    const onSettings = vi.fn();
    const onOther = vi.fn();
    onInvalidationReset(reset);
    onInvalidate('system_settings', onSettings);
    onInvalidate('rate_limit_rules', onOther);

    await startInvalidationBus();
    expect(invalidationBusState()).toBe('listening');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith('cache_invalidate', expect.any(Function), expect.any(Function));

    notify!(JSON.stringify({ topic: 'system_settings', key: 'auth' }));
    expect(onSettings).toHaveBeenCalledWith({ topic: 'system_settings', key: 'auth' });
    expect(onOther).not.toHaveBeenCalled();

    notify!('not json');
    notify!(JSON.stringify({ nope: 1 }));
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('订阅处理器抛错不影响其它订阅者', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    onInvalidate('t', bad);
    onInvalidate('t', good);
    dispatchInvalidation({ topic: 't' });
    expect(good).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('监听失败 → degraded 且不抛出；定时重试成功后恢复 listening', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    (listenMock as unknown as { mockImplementation: (fn: Listen) => void }).mockImplementation(async (_c, _n, onlisten) => {
      attempt += 1;
      if (attempt === 1) throw new Error('ECONNREFUSED');
      onlisten();
      return { state: 'ok' };
    });
    const reset = vi.fn();
    onInvalidationReset(reset);

    await expect(startInvalidationBus()).resolves.toBeUndefined();
    expect(invalidationBusState()).toBe('degraded');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('listen failed'));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toBe(2);
    expect(invalidationBusState()).toBe('listening');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('reconnected'));
  });

  it('重复启动只监听一次', async () => {
    (listenMock as unknown as { mockImplementation: (fn: Listen) => void }).mockImplementation(async (_c, _n, onlisten) => { onlisten(); return {}; });
    await startInvalidationBus();
    await startInvalidationBus();
    expect(listenMock).toHaveBeenCalledTimes(1);
  });
});
