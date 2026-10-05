import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
// 首次模块图转换在测试装配阶段完成；各用例再重载以选择业务时区。
import './push-send-logs.service';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../../lib/context', () => ({ currentUser: vi.fn() }));
vi.mock('../../lib/user-nicknames', () => ({ resolveUserNames: vi.fn() }));

const dialect = new PgDialect({ casing: 'snake_case' });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('TZ', 'UTC');
  vi.stubEnv('APP_TIME_ZONE', 'Asia/Shanghai');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T16:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** SQL 参数决定窗口；按数据库业务日分组返回真实记录的计数。 */
function mockStatsQuery(instants: string[], timeZone: string) {
  const windows: string[] = [];
  select.mockImplementation((fields: Record<string, SQL>) => {
    let condition: SQL;
    const counts = () => {
      const query = dialect.sqlToQuery(condition);
      const since = String(query.params[0]);
      windows.push(since);
      const dates = instants.filter((at) => Date.parse(at) >= Date.parse(since));
      const totals = { total: dates.length, success: dates.length, failed: 0, delivered: dates.length, clicked: 0 };
      if (!fields.date) return [totals];
      expect(dialect.sqlToQuery(fields.date).sql).toContain(`timezone('${timeZone}',`);
      const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const grouped = new Map<string, number>();
      for (const at of dates) {
        const key = format.format(new Date(at));
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      }
      return [...grouped].map(([date, total]) => ({ date, total, success: total, failed: 0, delivered: total, clicked: 0 }));
    };
    const query = {
      from: () => query,
      where: (where: SQL) => { condition = where; return query; },
      groupBy: () => query,
      then: (resolve: (value: object[]) => unknown) => Promise.resolve(counts()).then(resolve),
    };
    return query;
  });
  return windows;
}

describe('push statistics business-day buckets', () => {
  it('keeps the Shanghai midnight record in both totals and the current day bucket in a UTC process', async () => {
    const windows = mockStatsQuery(['2026-09-28T15:59:59Z', '2026-09-28T16:00:00Z', '2026-09-30T16:10:00Z'], 'Asia/Shanghai');
    const { getPushSendLogStats } = await import('./push-send-logs.service');
    const result = await getPushSendLogStats(3);
    expect(windows).toEqual(['2026-09-28T16:00:00.000Z', '2026-09-28T16:00:00.000Z']);
    expect(result.totals.total).toBe(2);
    expect(result.trend.map((day) => [day.date, day.total])).toEqual([
      ['2026-09-29', 1], ['2026-09-30', 0], ['2026-10-01', 1],
    ]);
  });

  it('keeps consecutive business dates across the New York autumn clock change', async () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York');
    vi.setSystemTime(new Date('2026-11-02T05:30:00Z'));
    const windows = mockStatsQuery(['2026-10-31T04:00:00Z', '2026-11-02T05:10:00Z'], 'America/New_York');
    const { getPushSendLogStats } = await import('./push-send-logs.service');
    const result = await getPushSendLogStats(3);
    expect(windows).toEqual(['2026-10-31T04:00:00.000Z', '2026-10-31T04:00:00.000Z']);
    expect(result.trend.map((day) => [day.date, day.total])).toEqual([
      ['2026-10-31', 1], ['2026-11-01', 0], ['2026-11-02', 1],
    ]);
  });
});
