/**
 * 有序转化漏斗（getFunnel）+ 双口径留存（getRetention）单测。
 *
 * 技术手段：mock `db.execute` 捕获真实 Drizzle `sql` 模板对象，再用
 * `PgDialect.sqlToQuery()` 纯文本编译（不连接真实数据库）校验生成的 SQL 结构，
 * 覆盖：
 *  - 转化窗口 conversionWindowHours 默认值/自定义值/夹紧边界
 *  - 有序步骤连接条件（>= prev.step_at 且 <= prev.first_at + 转化窗口）
 *  - segmentId 仅作用于首步 + 触发 tenant 归属校验
 *  - 步骤为空时短路，不发起查询
 *  - first_seen 模式的 true_first_seen CTE 不受日期过滤（对比 activity CTE 有日期过滤）
 *  - window_first 模式沿用旧版 user_days/first_day，且不含 true_first_seen
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const { execute, ensureSegmentAccessible, segmentMemberDistinctIdSubquery, tenantScope } = vi.hoisted(() => ({
  execute: vi.fn(async () => []),
  ensureSegmentAccessible: vi.fn(async () => ({ id: 1, tenantId: null })),
  segmentMemberDistinctIdSubquery: vi.fn(() => sql`SELECT distinct_id FROM analytics_segment_members WHERE segment_id = 42`),
  tenantScope: vi.fn(() => undefined as unknown),
}));

vi.mock('../../db', () => ({ db: { execute } }));
vi.mock('./analytics-segments.service', () => ({ ensureSegmentAccessible, segmentMemberDistinctIdSubquery }));
vi.mock('../../lib/tenant', () => ({ tenantScope }));

import { getFunnel, getRetention, retentionPeriodAxis } from './analytics-conversion.service';

const dialect = new PgDialect();
function renderLastExecuteCall(): { sqlText: string; params: unknown[] } {
  const arg = execute.mock.calls.at(-1)?.[0];
  const { sql: sqlText, params } = dialect.sqlToQuery(arg);
  return { sqlText, params };
}

describe('getFunnel — 有序转化漏斗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue([{ c0: 100, c1: 40, a1: 120000 }]);
  });

  it('short-circuits without querying when steps is empty', async () => {
    const result = await getFunnel({ steps: [], days: 30 } as never);
    expect(result).toEqual({ series: [], comparison: { type: 'none' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('defaults conversionWindowHours to 72 (make_interval(hours => $N))', async () => {
    await getFunnel({ steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }] } as never);
    const { params } = renderLastExecuteCall();
    expect(params).toContain(72);
  });

  it('clamps an out-of-range conversionWindowHours into [1, 720]', async () => {
    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      conversionWindowHours: 5000,
    } as never);
    const { params } = renderLastExecuteCall();
    expect(params).toContain(720);

    // 0 是 falsy，与 clampDays/clampLimit 同源的 `Number(x) || fallback` 写法一致，回落到默认值 72（而非夹到下限 1）
    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      conversionWindowHours: 0,
    } as never);
    const { params: params2 } = renderLastExecuteCall();
    expect(params2).toContain(72);

    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      conversionWindowHours: -5,
    } as never);
    const { params: params3 } = renderLastExecuteCall();
    expect(params3).toContain(1);
  });

  it('honors a custom conversionWindowHours within range', async () => {
    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      conversionWindowHours: 10,
    } as never);
    const { params } = renderLastExecuteCall();
    expect(params).toContain(10);
  });

  it('enforces strict step ordering: join condition requires createdAt >= prev.step_at and <= prev.first_at + window', async () => {
    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
    } as never);
    const { sqlText } = renderLastExecuteCall();
    expect(sqlText).toContain('>= prev.step_at');
    expect(sqlText).toContain('<= prev.first_at + make_interval(hours =>');
    expect(sqlText).toMatch(/\bs0\s+AS\s*\(/);
    expect(sqlText).toMatch(/\bs1\s+AS\s*\(/);
  });

  it('applies a segment comparison only to the first step and validates tenant ownership via ensureSegmentAccessible', async () => {
    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      comparison: { type: 'segments', segmentIds: [42] },
    } as never);
    expect(ensureSegmentAccessible).toHaveBeenCalledWith(42);
    expect(segmentMemberDistinctIdSubquery).toHaveBeenCalledWith(42);
    const { sqlText } = renderLastExecuteCall();
    // segment 子查询只应出现一次（仅首步 CTE 引用）：漏斗语义是「从同一批人出发」，
    // 每步都过滤会把中途换设备/换端的用户误判为流失
    const occurrences = sqlText.split('analytics_segment_members').length - 1;
    expect(occurrences).toBe(1);
  });

  it('runs one funnel per segment when comparing multiple segments', async () => {
    await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
      comparison: { type: 'segments', segmentIds: [1, 2, 3] },
    } as never);
    expect(ensureSegmentAccessible).toHaveBeenCalledWith(1);
    expect(ensureSegmentAccessible).toHaveBeenCalledWith(3);
    // 3 条序列 = 3 次漏斗查询（候选取值查询不涉及分群对比）
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does not touch segment helpers when the comparison axis is none', async () => {
    await getFunnel({ steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }] } as never);
    expect(ensureSegmentAccessible).not.toHaveBeenCalled();
    expect(segmentMemberDistinctIdSubquery).not.toHaveBeenCalled();
  });

  it('maps counts/averages back into a single overall series when no comparison is requested', async () => {
    execute.mockResolvedValue([{ c0: 100, c1: 40, a0: null, a1: 125000 }]);
    const result = await getFunnel({
      steps: [{ label: '浏览', eventName: 'view' }, { label: '下单', eventName: 'order' }],
    } as never);
    expect(result.series).toHaveLength(1);
    const series = result.series[0];
    expect(series.key).toBe('__overall__');
    expect(series.totalUsers).toBe(100);
    expect(series.steps[0]).toMatchObject({ users: 100, conversionRate: 100, averageConversionMs: null });
    expect(series.steps[1]).toMatchObject({ users: 40, conversionRate: 40, stepConversionRate: 40, dropoff: 60, averageConversionMs: 125000 });
    expect(series.overallConversionRate).toBe(40);
  });
});

describe('getRetention — 双口径留存（first_seen 全历史真实首访 vs window_first 窗口首现）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue([]);
  });

  it('returns mode="first_seen" when explicitly requested, and includes it in the result', async () => {
    const result = await getRetention({ days: 14, mode: 'first_seen' });
    expect(result.mode).toBe('first_seen');
  });

  it('falls back to mode="window_first" at the service layer when mode is omitted (route-level Zod default handles the "first_seen"-by-default API contract)', async () => {
    const result = await getRetention({ days: 14 });
    expect(result.mode).toBe('window_first');
  });

  it('first_seen mode: the true_first_seen CTE computes MIN(createdAt) over full tenant history with NO date lower-bound (">=") — unlike the activity CTE, which is date-bounded', async () => {
    await getRetention({ days: 14, mode: 'first_seen' });
    const { sqlText } = renderLastExecuteCall();
    expect(sqlText).toContain('true_first_seen');

    const activityMatch = sqlText.match(/activity AS \(([\s\S]*?)\),\s*true_first_seen/);
    const trueFirstSeenMatch = sqlText.match(/true_first_seen AS \(([\s\S]*?)\)\s*SELECT/);
    expect(activityMatch).toBeTruthy();
    expect(trueFirstSeenMatch).toBeTruthy();
    // activity CTE 受日期下界过滤（>=），true_first_seen CTE 不应包含同样的日期下界比较
    expect(activityMatch![1]).toContain('>=');
    expect(trueFirstSeenMatch![1]).not.toContain('>=');
  });

  it('first_seen mode: only cohorts whose true first-seen date falls within the analysis axis are kept (WHERE f.cohort_date BETWEEN axis bounds)', async () => {
    await getRetention({ days: 14, mode: 'first_seen' });
    const { sqlText } = renderLastExecuteCall();
    expect(sqlText).toMatch(/f\.cohort_date\s*>=.*AND\s*f\.cohort_date\s*<=/s);
  });

  it('window_first mode: uses the legacy user_days/first_day CTE pair and omits true_first_seen entirely', async () => {
    await getRetention({ days: 14, mode: 'window_first' });
    const { sqlText } = renderLastExecuteCall();
    expect(sqlText).toContain('user_days');
    expect(sqlText).toContain('first_day');
    expect(sqlText).not.toContain('true_first_seen');
  });

  it('applies tenantScope to both the activity CTE and (in first_seen mode) the full-history CTE', async () => {
    await getRetention({ days: 14, mode: 'first_seen' });
    // activityWhere + historyWhere 各调用一次 tenantScope(userEvents)
    expect(tenantScope).toHaveBeenCalledTimes(2);
  });

  it('represents empty cohorts as null values instead of zero-percent retention', async () => {
    const axis = retentionPeriodAxis('day', 14);
    execute.mockResolvedValue([{ cohort_date: axis.at(-1), day: axis.at(-1), active: 1 }]);

    const result = await getRetention({ days: 14, mode: 'first_seen', maxPeriods: 2 });
    const emptyCohort = result.series[0]?.cohorts.find((cohort) => cohort.cohortSize === 0);

    expect(emptyCohort).toBeDefined();
    expect(emptyCohort?.values).toEqual([null, null]);
  });
});
