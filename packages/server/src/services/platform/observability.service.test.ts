import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  infra: { database: 'ok', redis: 'ok', invalidationBus: 'ok' } as const,
  monitor: {
    database: { activeConnections: 3, totalConnections: 8 },
    redis: { connectedClients: 20, maxClients: 0, usedMemory: 1024 },
  },
  workers: 2,
  queue: {
    status: 'ok' as 'ok' | 'unavailable' | 'error',
    generatedAt: '2026-11-06T00:00:00.000Z' as string | null,
    queues: [{ queue: 'jobs', ready: 4, active: 1, deferred: 2, failed: 0, total: 7 }] as Array<{ queue: string; ready: number; active: number; deferred: number; failed: number; total: number }> | null,
    error: null as string | null,
  },
  workerRequired: null as number | null,
}));

vi.mock('../../config', () => ({
  config: {
    database: { maxConnections: 20 },
    get workerRequired() { return state.workerRequired; },
  },
}));
vi.mock('../../lib/health-checks', () => ({ checkInfraHealth: vi.fn(async () => state.infra) }));
vi.mock('../../lib/pg-boss-scheduler', () => ({
  countActiveWorkerNodes: vi.fn(async () => state.workers),
  getQueueDepthSnapshot: vi.fn(async () => state.queue),
}));
vi.mock('./monitor.service', () => ({
  getMonitorStatus: vi.fn(async () => state.monitor),
  getMonitorSampleState: vi.fn(() => ({ generatedAt: Date.now() - 1000, error: null })),
}));
vi.mock('../../lib/telemetry', () => ({
  getTelemetryStatus: vi.fn(() => ({ status: 'disabled', error: null })),
}));
vi.mock('../../lib/metrics-sampler', () => {
  const fast = { qps: 1, total: 100, errors: 1, errorRate: 1, latestAt: Date.now() - 1000 };
  const slow = { qps: 1, total: 1000, errors: 10, errorRate: 1, latestAt: Date.now() - 1000 };
  return {
    metricsSampler: {
      http: { windowStats: vi.fn((seconds: number) => seconds <= 300 ? fast : slow) },
    },
  };
});

import { getObservabilitySummary, observabilityInternals } from './observability.service';

beforeEach(() => {
  state.infra = { database: 'ok', redis: 'ok', invalidationBus: 'ok' };
  state.monitor = {
    database: { activeConnections: 3, totalConnections: 8 },
    redis: { connectedClients: 20, maxClients: 0, usedMemory: 1024 },
  };
  state.workers = 2;
  state.workerRequired = null;
  state.queue = {
    status: 'ok',
    generatedAt: '2026-11-06T00:00:00.000Z',
    queues: [{ queue: 'jobs', ready: 4, active: 1, deferred: 2, failed: 0, total: 7 }],
    error: null,
  };
});

describe('observability pure calculations', () => {
  const stats = { qps: 0, total: 100, errors: 1, errorRate: 1, latestAt: Date.now() };

  it('uses bad events / allowed bad rate for burn and clamps remaining budget', () => {
    expect(observabilityInternals.achieved(stats)).toBe(0.99);
    expect(observabilityInternals.burnRate(stats, 0.99)).toBe(1);
    expect(observabilityInternals.remainingBudget(stats, 0.99)).toBe(0);
    expect(observabilityInternals.burnRate({ ...stats, total: 0, errors: 0 }, 0.99)).toBeNull();
    expect(observabilityInternals.burnRate(stats, 1)).toBeNull();
  });

  it('does not invent freshness for an unsampled source and marks old samples stale', () => {
    const now = Date.parse('2026-11-06T00:00:30.000Z');
    expect(observabilityInternals.source('missing', null, now)).toMatchObject({ status: 'not_sampled', generatedAt: null, ageSeconds: null });
    expect(observabilityInternals.source('old', now - 31_000, now)).toMatchObject({ status: 'stale', ageSeconds: 31 });
    expect(observabilityInternals.source('failed', now - 1000, now, 'read_error').status).toBe('degraded');
  });
});

describe('getObservabilitySummary', () => {
  it('uses pool limit as DB denominator, leaves Redis utilization unknown without maxclients, and exposes both burns', async () => {
    const result = await getObservabilitySummary();
    expect(result.capacity.database).toMatchObject({ activeConnections: 3, observedConnections: 8, poolLimit: 20, utilization: 0.15 });
    expect(result.capacity.redis).toMatchObject({ connectedClients: 20, maxClients: null, utilization: null });
    expect(result.capacity.workers.required).toBeNull();
    expect(result.capacity.queues.items).toEqual([{ name: 'jobs', ready: 4, active: 1, deferred: 2, failed: 0 }]);
    expect(result.slos[0]).toMatchObject({
      achieved: 0.99,
      errorBudgetRemaining: 0,
      burnRateFast: 2,
      burnRateSlow: 2,
      fastWindow: { seconds: 300 },
      slowWindow: { seconds: 3600 },
    });
    expect(result.sources.find((source) => source.key === 'queue-depth')?.generatedAt).toBe('2026-11-06T00:00:00.000Z');
  });

  it('keeps a successful empty queue distinct from unavailable queue data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T00:00:20.000Z'));
    state.queue = { status: 'ok', generatedAt: '2026-11-06T00:00:00.000Z', queues: [], error: null };
    const empty = await getObservabilitySummary();
    expect(empty.capacity.queues).toMatchObject({ status: 'ok', items: [] });

    state.queue = { status: 'unavailable', generatedAt: null, queues: null, error: 'scheduler_not_initialized' };
    const unavailable = await getObservabilitySummary();
    expect(unavailable.capacity.queues).toMatchObject({ status: 'unavailable', items: null, error: 'scheduler_not_initialized' });
    expect(unavailable.status).toBe('unavailable');
    vi.useRealTimers();
  });
});
