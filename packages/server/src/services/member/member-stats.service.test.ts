import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMemberStats } from './member-stats.service';

const mocks = vi.hoisted(() => {
  vi.stubEnv('APP_TIME_ZONE', 'Asia/Shanghai');
  return { count: vi.fn() };
});
vi.mock('../../db', () => ({
  db: {
    $count: mocks.count,
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: async () => [{ v: 0 }] }),
      }),
    }),
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('会员统计业务月边界', () => {
  it.each(['UTC', 'America/New_York'])('月首统计排除上月、今日统计排除次日（TZ=%s）', async (processZone) => {
    vi.stubEnv('TZ', processZone);
    vi.stubEnv('APP_TIME_ZONE', 'Asia/Shanghai');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T17:30:00Z'));
    const dialect = new PgDialect();
    const createdTimes = [
      '2026-09-15T12:00:00Z',
      '2026-09-30T15:59:59Z',
      '2026-09-30T16:00:00Z',
      '2026-09-30T17:00:00Z',
      '2026-10-01T16:00:00Z',
    ].map(Date.parse);
    mocks.count.mockImplementation((_table: unknown, condition: SQL) => {
      const bounds = dialect.sqlToQuery(condition).params
        .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
        .map(Date.parse);
      return Promise.resolve(createdTimes.filter((at) => (!bounds[0] || at >= bounds[0]) && (!bounds[1] || at < bounds[1])).length);
    });
    const stats = await getMemberStats();
    expect(stats.monthNewMembers).toBe(3);
    expect(stats.todayNewMembers).toBe(2);
  });
});
