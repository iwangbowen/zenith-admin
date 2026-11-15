import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  strings: new Map<string, string>(),
  hashes: new Map<string, Record<string, string>>(),
  sets: new Map<string, Map<string, number>>(),
}));
vi.mock('./config', () => ({}));
vi.mock('../config', () => ({ config: { redis: { keyPrefix: 'test:' } } }));
vi.mock('./logger', () => ({ default: { warn: vi.fn() } }));
vi.mock('./rate-limit-redis', () => {
  const pipeline = () => {
    const ops: Array<() => unknown> = [];
    const chain = {
      hincrby: (key: string, field: string, delta: number) => {
        ops.push(() => {
          const h = state.hashes.get(key) ?? {};
          h[field] = String(Number(h[field] ?? 0) + delta);
          state.hashes.set(key, h);
          return Number(h[field]);
        });
        return chain;
      },
      expire: () => chain,
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => {
          const set = state.sets.get(key) ?? new Map();
          set.set(member, score);
          state.sets.set(key, set);
          return 1;
        });
        return chain;
      },
      zincrby: (key: string, delta: number, member: string) => {
        ops.push(() => {
          const set = state.sets.get(key) ?? new Map();
          set.set(member, (set.get(member) ?? 0) + delta);
          state.sets.set(key, set);
          return 1;
        });
        return chain;
      },
      zremrangebyrank: () => chain,
      hgetall: (key: string) => {
        ops.push(() => state.hashes.get(key) ?? {});
        return chain;
      },
      exec: async () => ops.map((op) => [null, op()]),
    };
    return chain;
  };
  return {
    limiterRedis: {
      pipeline,
      get: async (key: string) => state.strings.get(key) ?? null,
      set: async (key: string, value: string) => {
        state.strings.set(key, value);
        return 'OK';
      },
      hgetall: async (key: string) => state.hashes.get(key) ?? {},
      zrevrange: async (key: string, _start: number, _end: number, scores?: string) => {
        const list = [...(state.sets.get(key)?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
        return scores ? list.flatMap(([value, score]) => [value, String(score)]) : list.map(([value]) => value);
      },
    },
  };
});
import {
  flushRateLimitEvents,
  readRateLimitMetrics,
  recordRateLimitEvent,
  resetRateLimitMetrics,
} from './rate-limit-stats';
beforeEach(() => {
  state.strings.clear();
  state.hashes.clear();
  state.sets.clear();
});
describe('rate limit metrics', () => {
  it('distinguishes observation from actual denial and keeps unique events', async () => {
    const event = {
      name: 'review',
      key: '127.0.0.1',
      path: '/api/review/{id}',
      method: 'GET',
      correlationId: 'review',
    };
    recordRateLimitEvent({ ...event, decision: 'allowed' });
    recordRateLimitEvent({ ...event, decision: 'monitored' });
    recordRateLimitEvent({ ...event, decision: 'blocked' });
    recordRateLimitEvent({ ...event, decision: 'blocked' });
    await flushRateLimitEvents();
    const data = await readRateLimitMetrics('review', true);
    expect(data.hits).toBe(4);
    expect(data.blocked).toBe(2);
    expect(data.monitored).toBe(1);
    expect(new Set(data.events.map((e) => e.id)).size).toBe(3);
  });
  it('resets all views and prevents queued older events reappearing', async () => {
    recordRateLimitEvent({
      name: 'reset',
      key: '127.0.0.1',
      path: '/api/review',
      method: 'GET',
      correlationId: null,
      decision: 'blocked',
    });
    await resetRateLimitMetrics('reset');
    await flushRateLimitEvents();
    const data = await readRateLimitMetrics('reset', true);
    expect(data.hits).toBe(0);
    expect(data.events).toEqual([]);
    expect(data.topSources).toEqual([]);
  });
});
