import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
// 首次模块图转换在测试装配阶段完成；各用例再重载以选择业务时区。
import './workflow-analytics.service';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, roles: ['super_admin'], tenantId: null }) }));

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

function mockAnalyticsQueries(created: string[], completed: string[], timeZone: string) {
  const windows = new Map<number, string>();
  let selection = 0;
  select.mockImplementation((fields: Record<string, SQL>) => {
    const index = selection++;
    let condition: SQL | undefined;
    const counts = () => {
      if (index === 0) return [{ status: 'running', count: 1 }];
      if (index === 1) return [{ avg: null }];
      if ([2, 9, 10].includes(index)) return [{ count: 0 }];
      if (![3, 7, 8].includes(index)) return [];
      const rendered = dialect.sqlToQuery(condition!);
      const since = String(rendered.params.find((param) => typeof param === 'string' && /^\d{4}-/.test(param)));
      windows.set(index, since);
      const dates = (index === 8 ? completed : created).filter((at) => Date.parse(at) >= Date.parse(since));
      if (index === 3) return [{ count: dates.length }];
      expect(dialect.sqlToQuery(fields.d).sql).toContain(`timezone('${timeZone}',`);
      const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const grouped = new Map<string, number>();
      for (const at of dates) {
        const key = format.format(new Date(at));
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      }
      return [...grouped].map(([d, c]) => ({ d, c }));
    };
    const query = {
      from: () => query,
      where: (where?: SQL) => { condition = where; return query; },
      innerJoin: () => query,
      groupBy: () => query,
      orderBy: () => query,
      limit: () => query,
      then: (resolve: (value: object[]) => unknown) => Promise.resolve(counts()).then(resolve),
    };
    return query;
  });
  return windows;
}

describe('workflow analytics business-day trend', () => {
  it('includes the complete first and current business days while preserving the rolling seven-day KPI', async () => {
    const windows = mockAnalyticsQueries(
      ['2026-09-17T15:59:59Z', '2026-09-17T16:00:00Z', '2026-09-30T16:10:00Z'],
      ['2026-09-30T16:20:00Z'], 'Asia/Shanghai',
    );
    const { getWorkflowAnalytics } = await import('./workflow-analytics.service');
    const result = await getWorkflowAnalytics();
    expect(windows.get(7)).toBe('2026-09-17T16:00:00.000Z');
    expect(windows.get(8)).toBe('2026-09-17T16:00:00.000Z');
    expect(windows.get(3)).toBe('2026-09-23T16:30:00.000Z');
    expect(result.recentCreated).toBe(1);
    expect(result.trend).toHaveLength(14);
    expect(result.trend[0]).toEqual({ date: '2026-09-18', created: 1, completed: 0, pending: 1 });
    expect(result.trend.at(-1)).toEqual({ date: '2026-10-01', created: 1, completed: 1, pending: 1 });
    expect(result.trend.reduce((total, day) => total + day.created, 0)).toBe(2);
    expect(result.trend.reduce((total, day) => total + day.completed, 0)).toBe(1);
  });

  it('retains a current day bucket after the New York autumn clock change', async () => {
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York');
    vi.setSystemTime(new Date('2026-11-02T05:30:00Z'));
    const windows = mockAnalyticsQueries(['2026-10-20T04:00:00Z', '2026-11-02T05:10:00Z'], ['2026-11-02T05:20:00Z'], 'America/New_York');
    const { getWorkflowAnalytics } = await import('./workflow-analytics.service');
    const result = await getWorkflowAnalytics();
    expect(windows.get(7)).toBe('2026-10-20T04:00:00.000Z');
    expect(windows.get(8)).toBe('2026-10-20T04:00:00.000Z');
    expect(result.trend).toHaveLength(14);
    expect(result.trend[0]).toEqual({ date: '2026-10-20', created: 1, completed: 0, pending: 1 });
    expect(result.trend.at(-1)).toEqual({ date: '2026-11-02', created: 1, completed: 1, pending: 1 });
  });

  it('keeps the rolling seven-day KPI at exactly 168 hours in a process that crosses daylight saving', async () => {
    vi.stubEnv('TZ', 'America/New_York');
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York');
    vi.setSystemTime(new Date('2026-11-02T05:30:00Z'));
    const windows = mockAnalyticsQueries(['2026-10-26T05:29:59Z', '2026-10-26T05:30:00Z'], [], 'America/New_York');
    const { getWorkflowAnalytics } = await import('./workflow-analytics.service');
    const result = await getWorkflowAnalytics();
    expect(windows.get(3)).toBe('2026-10-26T05:30:00.000Z');
    expect(result.recentCreated).toBe(1);
  });
});
