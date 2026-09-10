import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WsMessage } from '@zenith/shared/platform';

type Fanout = typeof import('./ws-fanout');
type RedisStub = ReturnType<typeof import('../test-utils/redis-stub').createRedisStub>;

const PING: WsMessage = { type: 'announcement:read-all', payload: {} };

let fanout: Fanout;
let redis: RedisStub;

beforeEach(async () => {
  vi.resetModules();
  fanout = await import('./ws-fanout');
  redis = (await import('./redis')).default as unknown as RedisStub;
});
afterEach(() => vi.restoreAllMocks());

describe('publishWsFanout', () => {
  it('发布带版本与进程标识的信封到固定频道', async () => {
    fanout.publishWsFanout({ kind: 'user', target: 7, message: PING });
    await vi.waitFor(() => expect(fanout.getWsFanoutCounters().published).toBe(1));
    const publish = redis.publish as ReturnType<typeof vi.fn>;
    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, raw] = publish.mock.calls[0] as [string, string];
    expect(channel).toBe(fanout.WS_FANOUT_CHANNEL);
    expect(JSON.parse(raw)).toEqual({ v: 1, from: expect.stringMatching(/^.+:\d+$/), kind: 'user', target: 7, message: PING });
  });

  it('发布失败只计数并节流告警，不向调用方抛出', async () => {
    (redis.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(() => fanout.publishWsFanout({ kind: 'broadcast', message: PING })).not.toThrow();
    await vi.waitFor(() => expect(fanout.getWsFanoutCounters().publishFailed).toBe(1));
  });
});

describe('dispatchWsFanout', () => {
  it('自己发出的信封跳过，其他进程的信封交给对应 kind 的处理器', async () => {
    const handler = vi.fn();
    fanout.onWsFanout('user', handler);
    const { PROCESS_ID } = await import('./process-identity');

    await fanout.dispatchWsFanout(JSON.stringify({ v: 1, from: PROCESS_ID, kind: 'user', target: 1, message: PING }));
    expect(handler).not.toHaveBeenCalled();

    await fanout.dispatchWsFanout(JSON.stringify({ v: 1, from: 'other:1', kind: 'user', target: 1, message: PING }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'user', target: 1, message: PING }));
    expect(fanout.getWsFanoutCounters().delivered).toBe(1);
  });

  it('畸形载荷、未知版本、无处理器与处理器异常都计入 dropped 且不抛出', async () => {
    fanout.onWsFanout('broadcast', () => { throw new Error('boom'); });
    await fanout.dispatchWsFanout('not-json');
    await fanout.dispatchWsFanout(JSON.stringify({ v: 2, from: 'x:1', kind: 'broadcast', message: PING }));
    await fanout.dispatchWsFanout(JSON.stringify({ v: 1, from: 'x:1', kind: 'token', target: 't', message: PING }));
    await fanout.dispatchWsFanout(JSON.stringify({ v: 1, from: 'x:1', kind: 'broadcast', message: PING }));
    expect(fanout.getWsFanoutCounters()).toMatchObject({ delivered: 0, dropped: 4 });
  });

  it('同一 kind 后注册者覆盖，取消函数只移除自己', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = fanout.onWsFanout('user', first);
    fanout.onWsFanout('user', second);
    offFirst(); // first 已被覆盖，不应把 second 也移掉
    void fanout.dispatchWsFanout(JSON.stringify({ v: 1, from: 'x:1', kind: 'user', target: 1, message: PING }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('startWsFanoutSubscriber', () => {
  it('用独立连接订阅频道，收到消息即派发；重复启动幂等', async () => {
    const handler = vi.fn();
    fanout.onWsFanout('user', handler);
    await fanout.startWsFanoutSubscriber();
    await fanout.startWsFanoutSubscriber();
    expect(fanout.wsFanoutState()).toBe('subscribed');
    const duplicate = redis.duplicate as ReturnType<typeof vi.fn>;
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(duplicate).toHaveBeenCalledWith({ enableAutoPipelining: false, lazyConnect: true });

    // 经经纪从「另一个进程」发布
    await redis.publish(fanout.WS_FANOUT_CHANNEL, JSON.stringify({ v: 1, from: 'peer:9', kind: 'user', target: 3, message: PING }));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(expect.objectContaining({ target: 3 })));

    await fanout.stopWsFanoutSubscriber();
    expect(fanout.wsFanoutState()).toBe('idle');
  });

  it('首次连接失败进入降级而不抛出', async () => {
    const sub = (await import('../test-utils/redis-stub')).createRedisStub();
    (sub.connect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    (redis.duplicate as ReturnType<typeof vi.fn>).mockReturnValueOnce(sub);
    await expect(fanout.startWsFanoutSubscriber()).resolves.toBeUndefined();
    expect(fanout.wsFanoutState()).toBe('degraded');
  });
});
