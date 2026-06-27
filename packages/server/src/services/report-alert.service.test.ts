/**
 * 报表预警纯函数单测：行集聚合 + 阈值比较。
 */
import { describe, it, expect } from 'vitest';
import { aggregate, compare } from './report-alert.service';
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
