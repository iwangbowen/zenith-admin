import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
// 首次模块图转换在测试装配阶段完成；各用例再重载以选择业务时区。
import './workflow-analytics.service';

const { select, readSnapshot, state } = vi.hoisted(() => ({ select: vi.fn(), readSnapshot: vi.fn(), state: { user: { userId: 1, roles: ['super_admin'], tenantId: null as number | null } } }));
vi.mock('../../db', () => ({ db: { select }, readSnapshot }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.user }));
vi.mock('../../lib/data-scope', () => ({ getDataScopeCondition: vi.fn(async () => undefined) }));

const dialect = new PgDialect({ casing: 'snake_case' });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.user = { userId: 1, roles: ['super_admin'], tenantId: null };
  readSnapshot.mockImplementation((fn: (tx: { select: typeof select }) => Promise<unknown>) => fn({ select }));
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
      leftJoin: () => query,
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
  it('scopes every aggregate including jobs and subprocesses to the tenant and definition in one snapshot', async () => {
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    state.user = { userId: 7, roles: ['tenant_admin'], tenantId: 23 };
    const renderedConditions: Array<{ sql: string; params: unknown[] }> = [];
    const tables: string[] = [];
    select.mockImplementation(() => {
      const query = {
        from: (table: Parameters<typeof getTableName>[0]) => { tables.push(getTableName(table)); return query; },
        where: (where: SQL) => { renderedConditions.push(dialect.sqlToQuery(where)); return query; },
        innerJoin: () => query, leftJoin: () => query, groupBy: () => query, orderBy: () => query, limit: () => query,
        then: (resolve: (rows: object[]) => unknown) => Promise.resolve([]).then(resolve),
      };
      return query;
    });
    const { getWorkflowAnalytics } = await import('./workflow-analytics.service');
    const result = await getWorkflowAnalytics({ definitionId: 42 });
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(tables).toHaveLength(14);
    expect(tables.filter(table => table === 'workflow_jobs')).toHaveLength(2);
    expect(renderedConditions).toHaveLength(14);
    for (const condition of renderedConditions) {
      expect(condition.sql).toContain('tenant_id');
      expect(condition.sql).toContain('definition_id');
      expect(condition.params).toEqual(expect.arrayContaining([23, 42]));
    }
    expect(result.total).toBe(0);
    expect(result.avgDurationSec).toBeNull();
    expect(result.trend).toHaveLength(14);
  });
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
