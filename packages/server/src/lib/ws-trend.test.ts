/**
 * WS 趋势采样测试：增量差分、计数器回退丢弃、容量上限。
 * 采集器直接读集群快照，因此这里注册 / 移除假连接来制造计数器变化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sampling = vi.hoisted(() => ({
  roles: { api: true },
  listeners: new Set<() => void>(),
}));
vi.mock('../config', () => ({ config: { roles: sampling.roles } }));
vi.mock('./logger', () => ({ default: { warn: vi.fn() } }));
vi.mock('./metrics-sampler', () => ({ metricsSampler: {
  subscribe: vi.fn((fn: () => void) => {
    sampling.listeners.add(fn);
    return () => sampling.listeners.delete(fn);
  }),
} }));
vi.mock('./process-identity', () => ({ PROCESS_ID: 'worker:1' }));

const snapshot = {
  currentConnections: 2,
  currentUsers: 2,
  totalConnects: 10,
  totalDisconnects: 4,
  totalSent: 100,
  totalRecv: 40,
  messages: [] as Array<{ success: boolean }>,
  nodes: [],
  topics: [],
  connections: [
    { lastActivityAt: 0 },
    { lastActivityAt: 0 },
  ],
  recentDisconnects: [],
  fanout: { nodes: [] as Array<{ nodeId: string; state: 'idle' | 'subscribed' | 'degraded' }> },
};

vi.mock('../lib/ws-manager', () => ({
  getWsClusterSnapshot: () => snapshot,
}));

const { WS_TREND_CAPACITY, getWsTrend, recordWsTrendSample, resetWsTrend, takeWsTrendWindow, startWsTrendSampling, stopWsTrendSampling } = await import('./ws-trend');

afterEach(() => stopWsTrendSampling());

describe('ws trend sampler', () => {
  beforeEach(() => {
    resetWsTrend();
    sampling.roles.api = true;
    snapshot.fanout.nodes = [];
    snapshot.currentConnections = 2;
    snapshot.currentUsers = 2;
    snapshot.totalConnects = 10;
    snapshot.totalDisconnects = 4;
    snapshot.totalSent = 100;
    snapshot.totalRecv = 40;
    snapshot.messages = [];
    snapshot.connections = [{ lastActivityAt: 0 }, { lastActivityAt: 0 }];
  });

  it('first frame only builds the counter baseline', () => {
    expect(recordWsTrendSample(1000)).toBeNull();
    expect(getWsTrend().points).toHaveLength(0);
  });

  it('records per-cycle counter deltas and instantaneous connection state', () => {
    recordWsTrendSample(1000);
    snapshot.totalConnects = 13;
    snapshot.totalDisconnects = 5;
    snapshot.totalSent = 160;
    snapshot.totalRecv = 44;
    // 第二条停留在上一帧的活动时间：超 120 秒空闲阈值
    snapshot.connections = [{ lastActivityAt: 130_000 }, { lastActivityAt: 1000 }];
    snapshot.messages = [{ success: true }, { success: false }];

    const point = recordWsTrendSample(130_000);
    expect(point).toMatchObject({
      t: 130_000,
      connections: 2,
      users: 2,
      idle: 1,
      connects: 3,
      disconnects: 1,
      sent: 60,
      recv: 4,
      failed: 1,
    });
  });

  it('drops the frame when counters regress (process restart) and recovers next tick', () => {
    snapshot.connections = [{ lastActivityAt: 2000 }];
    recordWsTrendSample(2000);
    snapshot.totalSent = 10; // 节点重启：计数器回退
    expect(recordWsTrendSample(12_000)).toBeNull();
    snapshot.totalSent = 30;
    // 回退帧已重建基线，本帧按新基线差分，不出现负值；丢弃的两帧不进缓冲
    expect(recordWsTrendSample(22_000)).toMatchObject({ sent: 20 });
    expect(getWsTrend().points).toHaveLength(1);
  });

  it('aggregates the buffered window into one persisted row and advances the cursor', () => {
    // 不足一个采样周期：不下沉半截窗口，也不推进游标
    recordWsTrendSample(1000);
    expect(takeWsTrendWindow()).toBeNull();

    snapshot.totalConnects = 12;
    snapshot.totalDisconnects = 6;
    snapshot.totalSent = 140;
    snapshot.totalRecv = 50;
    snapshot.messages = [{ success: true }];
    recordWsTrendSample(11_000);
    snapshot.totalSent = 200;
    snapshot.messages = [{ success: false }, { success: false }, { success: true }];
    recordWsTrendSample(21_000);

    // 瞬时列取窗口末值，增量列取窗口内之和，失败列取窗口内峰值
    expect(takeWsTrendWindow()).toMatchObject({
      sampledAt: new Date(21_000),
      connections: 2,
      users: 2,
      connects: 2,
      disconnects: 2,
      sent: 100,
      recv: 10,
      failed: 2,
    });

    // 游标已推进：没有新帧时不再重复下沉同一批点
    expect(takeWsTrendWindow()).toBeNull();

    snapshot.totalSent = 260;
    recordWsTrendSample(31_000);
    snapshot.totalSent = 300;
    recordWsTrendSample(41_000);
    expect(takeWsTrendWindow()).toMatchObject({ sampledAt: new Date(41_000), sent: 100 });
  });

  it('resets the persist cursor together with the buffer', () => {
    recordWsTrendSample(1000);
    recordWsTrendSample(11_000);
    recordWsTrendSample(21_000);
    expect(takeWsTrendWindow()).toMatchObject({ sampledAt: new Date(21_000) });
    resetWsTrend();
    recordWsTrendSample(1000);
    recordWsTrendSample(11_000);
    recordWsTrendSample(21_000);
    // 清空后重新累积，游标一并归零，新一批点仍可下沉（而不是因为游标还停在过去而漏掉）
    expect(takeWsTrendWindow()).toMatchObject({ sampledAt: new Date(21_000) });
    expect(takeWsTrendWindow()).toBeNull();
  });

  it('uses an external persisted boundary without consuming the window before a successful database commit', () => {
    recordWsTrendSample(1000);
    snapshot.totalSent = 120;
    recordWsTrendSample(11_000);
    snapshot.totalSent = 150;
    recordWsTrendSample(21_000);
    const retry = takeWsTrendWindow(0);
    expect(retry).toMatchObject({ sampledAt: new Date(21_000), sent: 50 });
    // 失败不推进任何游标，同一数据库边界可重试原窗口。
    expect(takeWsTrendWindow(0)).toEqual(retry);
    snapshot.totalSent = 170;
    recordWsTrendSample(31_000);
    expect(takeWsTrendWindow(21_000)).toBeNull();
    snapshot.totalSent = 210;
    recordWsTrendSample(41_000);
    expect(takeWsTrendWindow(21_000)).toMatchObject({ sampledAt: new Date(41_000), sent: 60 });
    expect(takeWsTrendWindow(41_000)).toBeNull();
  });

  it('pure worker skips missing API mirrors and degraded subscriptions, rebuilding baseline after recovery', () => {
    sampling.roles.api = false;
    snapshot.fanout.nodes = [{ nodeId: 'worker:1', state: 'subscribed' }];
    expect(recordWsTrendSample(1000)).toBeNull();
    expect(takeWsTrendWindow()).toBeNull();
    snapshot.fanout.nodes.push({ nodeId: 'api:1', state: 'subscribed' });
    expect(recordWsTrendSample(11_000)).toBeNull();
    snapshot.totalSent += 20;
    expect(recordWsTrendSample(21_000)).toMatchObject({ sent: 20 });
    snapshot.fanout.nodes[0].state = 'degraded';
    snapshot.totalSent += 50;
    expect(recordWsTrendSample(31_000)).toBeNull();
    snapshot.fanout.nodes[0].state = 'subscribed';
    expect(recordWsTrendSample(41_000)).toBeNull();
    snapshot.totalSent += 10;
    expect(recordWsTrendSample(51_000)).toMatchObject({ sent: 10 });
    snapshot.fanout.nodes.pop();
    expect(recordWsTrendSample(61_000)).toBeNull();
    expect(getWsTrend().points).toHaveLength(2);
  });

  it('starts one tick subscriber, stops it idempotently, and can restart', () => {
    startWsTrendSampling();
    startWsTrendSampling();
    expect(sampling.listeners.size).toBe(1);
    for (const tick of sampling.listeners) tick();
    for (const tick of sampling.listeners) tick();
    expect(getWsTrend().points).toHaveLength(1);
    stopWsTrendSampling();
    stopWsTrendSampling();
    expect(sampling.listeners.size).toBe(0);
    startWsTrendSampling();
    expect(sampling.listeners.size).toBe(1);
  });

  it('keeps at most the ring capacity and returns points in ascending time order', () => {
    recordWsTrendSample(0);
    for (let i = 1; i <= WS_TREND_CAPACITY + 5; i += 1) {
      snapshot.totalSent = 100 + i;
      recordWsTrendSample(i * 1000);
    }
    const { points, intervalSec, capacity } = getWsTrend();
    expect(intervalSec).toBe(10);
    expect(capacity).toBe(WS_TREND_CAPACITY);
    expect(points).toHaveLength(WS_TREND_CAPACITY);
    expect(points[0]!.t).toBe(6000);
  });
});
