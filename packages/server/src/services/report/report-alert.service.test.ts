/**
 * 报表预警纯函数单测：行集聚合 + 阈值比较 + 静默窗口判定。
 */
import { describe, it, expect } from 'vitest';
import { aggregate, compare, shouldNotifyTrigger } from './report-alert.service';
import type { ReportAlertAggregate, ReportAlertOp } from '@zenith/shared';

const rows = [{ v: 10 }, { v: 20 }, { v: 30 }];
const agg = (a: ReportAlertAggregate, field: string | null = 'v') => aggregate(rows, field, a);

describe('aggregate', () => {
  it('sum / avg / max / min / first', () => {
    expect(agg('sum')).toBe(60);
    expect(agg('avg')).toBe(20);
    expect(agg('max')).toBe(30);
    expect(agg('min')).toBe(10);
    expect(agg('first')).toBe(10);
  });
  it('count 返回行数（忽略字段）', () => {
    expect(agg('count')).toBe(3);
    expect(aggregate(rows, null, 'count')).toBe(3);
  });
  it('空集返回 0', () => {
    expect(aggregate([], 'v', 'sum')).toBe(0);
  });
  it('无字段时回落为行数（按计数处理）', () => {
    expect(aggregate(rows, null, 'sum')).toBe(3);
  });
});

describe('compare', () => {
  const cases: Array<[number, ReportAlertOp, number, boolean]> = [
    [5, 'gt', 3, true], [3, 'gt', 3, false],
    [3, 'gte', 3, true], [2, 'gte', 3, false],
    [2, 'lt', 3, true], [3, 'lt', 3, false],
    [3, 'lte', 3, true], [4, 'lte', 3, false],
    [3, 'eq', 3, true], [3, 'eq', 4, false],
    [3, 'neq', 4, true], [3, 'neq', 3, false],
  ];
  it.each(cases)('compare(%i, %s, %i) === %s', (value, op, threshold, expected) => {
    expect(compare(value, op, threshold)).toBe(expected);
  });
});

describe('shouldNotifyTrigger（静默窗口）', () => {
  const now = new Date('2026-07-05 12:00:00');
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('新触发（上次未触发）无视静默期立即通知', () => {
    expect(shouldNotifyTrigger(false, 60, minsAgo(1), now)).toBe(true);
    expect(shouldNotifyTrigger(false, 60, null, now)).toBe(true);
  });
  it('持续触发且在静默窗口内不重复通知', () => {
    expect(shouldNotifyTrigger(true, 60, minsAgo(30), now)).toBe(false);
    expect(shouldNotifyTrigger(true, 60, minsAgo(59), now)).toBe(false);
  });
  it('持续触发但静默期已过则再次通知', () => {
    expect(shouldNotifyTrigger(true, 60, minsAgo(60), now)).toBe(true);
    expect(shouldNotifyTrigger(true, 60, minsAgo(120), now)).toBe(true);
  });
  it('silenceMins=0 每次触发都通知', () => {
    expect(shouldNotifyTrigger(true, 0, minsAgo(1), now)).toBe(true);
  });
  it('持续触发但从未通知过（历史数据）则通知', () => {
    expect(shouldNotifyTrigger(true, 60, null, now)).toBe(true);
  });
  it('负数静默期按 0 处理', () => {
    expect(shouldNotifyTrigger(true, -5, minsAgo(1), now)).toBe(true);
  });
});
