import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { WsTrendSample } from '../../lib/ws-trend';

const state = vi.hoisted(() => ({
  snapshot: { currentConnections: 2, currentUsers: 1, totalConnects: 2, totalDisconnects: 0, totalSent: 0, totalRecv: 0, connections: [], messages: [] },
  stored: [] as WsTrendSample[],
  failNextWrite: false,
  transaction: vi.fn(),
  events: [] as string[],
  lockQueries: [] as SQL[],
}));
vi.mock('../../db', () => ({ db: { transaction: state.transaction } }));
vi.mock('../../config', () => ({ config: { roles: { api: true }, licenseMode: 'off', log: { level: 'silent' } } }));
vi.mock('../../lib/ws-manager', () => ({ getWsClusterSnapshot: () => state.snapshot }));
vi.mock('../../lib/metrics-sampler', () => ({ metricsSampler: { getLatest: () => null, subscribe: vi.fn() } }));
vi.mock('../../lib/settings', () => ({ getSettings: async () => ({ enabled: false }) }));
vi.mock('../../lib/logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock('./monitor.service', () => ({ getDisks: vi.fn(), getLinuxMemInfo: vi.fn() }));
vi.mock('../workflow/workflow-engine-ops.service', () => ({ getLatestEngineHealthMetrics: vi.fn() }));
vi.mock('../workflow/workflow-jobs.service', () => ({ getWorkflowJobAlertMetrics: vi.fn() }));
vi.mock('../payment/payment-alert-metrics.service', () => ({ getPaymentAlertMetrics: vi.fn() }));
vi.mock('../open-platform/open-platform-alert-metrics.service', () => ({ getOpenPlatformAlertMetrics: vi.fn() }));
vi.mock('./scheduler-alert-metrics.service', () => ({ getSchedulerAlertMetrics: vi.fn() }));
vi.mock('./job-monitor-metrics.service', () => ({ getJobMonitorAlertMetrics: vi.fn() }));
vi.mock('../analytics/session-replays.service', () => ({ getReplayStorageMbMetric: vi.fn() }));
vi.mock('../../lib/log-metrics', () => ({ getLogAlertMetrics: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  state.stored = [];
  state.events = [];
  state.lockQueries = [];
  state.failNextWrite = false;
  let tail = Promise.resolve();
  // 模拟共享数据库的事务锁与提交边界；窗口来自每个 worker 的真实独立缓冲。
  state.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => {
    const previous = tail;
    let unlock!: () => void;
    tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    let pending: WsTrendSample | null = null;
    const tx = {
      execute: async (query: SQL) => { state.events.push('lock'); state.lockQueries.push(query); },
      select: () => ({
        from: () => ({ orderBy: () => ({ limit: async () => {
          state.events.push('read');
          const latest = state.stored.at(-1);
          return latest ? [{ sampledAt: latest.sampledAt }] : [];
        } }) }),
      }),
      insert: () => ({ values: async (sample: WsTrendSample) => {
        state.events.push('insert');
        if (state.failNextWrite) {
          state.failNextWrite = false;
          throw new Error('database write failed');
        }
        pending = sample;
      } }),
    };
    try {
      const result = await run(tx);
      if (pending) state.stored.push(pending);
      return result;
    } finally {
      unlock();
    }
  });
});

async function worker(points: Array<[number, number]>) {
  vi.resetModules();
  const trend = await import('../../lib/ws-trend');
  for (const [t, sent] of points) {
    state.snapshot.totalSent = sent;
    trend.recordWsTrendSample(t);
  }
  const { persistMetricSample } = await import('./monitor-history.service');
  return { persistMetricSample, trend };
}

describe('WebSocket 历史持久化全局边界', () => {
  it('两个 worker 轮换只保存数据库边界后的增量，不重放各自的旧窗口', async () => {
    const first = await worker([[1000, 0], [11_000, 10], [21_000, 20]]);
    const second = await worker([[1000, 0], [11_000, 10], [21_000, 20], [31_000, 30], [41_000, 40]]);
    expect((await first.persistMetricSample()).wsTrendStored).toBe(true);
    expect((await second.persistMetricSample()).wsTrendStored).toBe(true);
    expect(state.stored.map((row) => ({ t: row.sampledAt.getTime(), sent: row.sent }))).toEqual([
      { t: 21_000, sent: 20 }, { t: 41_000, sent: 20 },
    ]);
    expect((await first.persistMetricSample()).wsTrendStored).toBe(false);
    expect(state.stored).toHaveLength(2);
    expect(state.events).toEqual(['lock', 'read', 'insert', 'lock', 'read', 'insert', 'lock', 'read']);
    const dialect = new PgDialect();
    expect(state.lockQueries.map((query) => dialect.sqlToQuery(query).sql)).toEqual(Array(3).fill(
      "SELECT pg_advisory_xact_lock(hashtextextended('zenith:ws-metric-samples', 0))",
    ));
  }, 60_000);

  it('manual 与 Cron 并发读取同一窗口时仅提交一次', async () => {
    const first = await worker([[1000, 0], [11_000, 10], [21_000, 20]]);
    const second = await worker([[1000, 0], [11_000, 10], [21_000, 20]]);
    const results = await Promise.all([first.persistMetricSample(), second.persistMetricSample()]);
    expect(results.filter((result) => result.wsTrendStored)).toHaveLength(1);
    expect(state.stored).toHaveLength(1);
  }, 60_000);

  it('写库失败不消费本地窗口，重试保留完整增量', async () => {
    const { persistMetricSample, trend } = await worker([[1000, 0], [11_000, 10], [21_000, 20]]);
    state.failNextWrite = true;
    await expect(persistMetricSample()).rejects.toThrow('database write failed');
    expect(state.stored).toEqual([]);
    expect(trend.takeWsTrendWindow(0)).toMatchObject({ sent: 20 });
    expect((await persistMetricSample()).wsTrendStored).toBe(true);
    expect(state.stored).toHaveLength(1);
    expect(state.stored[0].sent).toBe(20);
  });

  it('没有足够的新采样点时不写虚假空行', async () => {
    const { persistMetricSample } = await worker([[1000, 0], [11_000, 10]]);
    expect((await persistMetricSample()).wsTrendStored).toBe(false);
    expect(state.stored).toEqual([]);
  });
});
