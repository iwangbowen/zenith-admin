import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { HttpMetricsCollector } from './metrics-sampler';

const BASE_TIME = Date.parse('2026-11-06T00:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => vi.useRealTimers());

describe('HttpMetricsCollector windows', () => {
  it('counts status >= 400 as bad events and reports the latest real event time', () => {
    const collector = new HttpMetricsCollector();
    collector.record(10, 200);
    collector.record(20, 399);
    collector.record(30, 400);
    collector.record(40, 500);

    expect(collector.windowStats(300)).toEqual({
      qps: 0.01,
      total: 4,
      errors: 2,
      errorRate: 50,
      latestAt: BASE_TIME,
    });
  });

  it('keeps the existing 60-second display default while retaining a one-hour SLO window', () => {
    const collector = new HttpMetricsCollector();
    collector.record(10, 200);
    vi.setSystemTime(BASE_TIME + 61_000);

    expect(collector.windowStats()).toMatchObject({ total: 0, errors: 0, latestAt: null });
    expect(collector.windowStats(3600)).toMatchObject({ total: 1, errors: 0, latestAt: BASE_TIME });
  });

  it('excludes the exact left boundary and clamps oversized windows to retention', () => {
    const collector = new HttpMetricsCollector();
    collector.record(10, 200);
    vi.setSystemTime(BASE_TIME + 300_000);
    expect(collector.windowStats(300).total).toBe(0);

    vi.setSystemTime(BASE_TIME + 301_000);
    expect(collector.windowStats(99_999).total).toBe(1);
  });
});
