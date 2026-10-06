/**
 * WS 趋势采样测试：增量差分、计数器回退丢弃、容量上限。
 * 采集器直接读集群快照，因此这里注册 / 移除假连接来制造计数器变化。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
};

vi.mock('../lib/ws-manager', () => ({
  getWsClusterSnapshot: () => snapshot,
}));

const { WS_TREND_CAPACITY, getWsTrend, recordWsTrendSample, resetWsTrend } = await import('./ws-trend');

describe('ws trend sampler', () => {
  beforeEach(() => {
    resetWsTrend();
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
