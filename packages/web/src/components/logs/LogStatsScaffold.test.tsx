import { describe, expect, it } from 'vitest';
import { calcSuccessRate, calcSuccessRateDelta, deltaOf } from './LogStatsScaffold';

describe('LogStatsScaffold helpers', () => {
  it('returns null delta when previous period has no data', () => {
    expect(deltaOf(10, 0)).toBeNull();
    expect(deltaOf(10, -1)).toBeNull();
  });

  it('calculates numeric delta against a populated previous period', () => {
    expect(deltaOf(12, 8)).toBe(4);
    expect(deltaOf(5, 8)).toBe(-3);
  });

  it('calculates formatted success rate', () => {
    expect(calcSuccessRate({ total: 4, successCount: 3 })).toBe('75.0');
    expect(calcSuccessRate({ total: 0, successCount: 0 })).toBeNull();
    expect(calcSuccessRate(null)).toBeNull();
  });

  it('calculates success rate delta only when both periods have totals', () => {
    expect(calcSuccessRateDelta({ total: 10, successCount: 8 }, { total: 5, successCount: 3 })).toBeCloseTo(0.2);
    expect(calcSuccessRateDelta({ total: 0, successCount: 0 }, { total: 5, successCount: 3 })).toBeNull();
    expect(calcSuccessRateDelta({ total: 10, successCount: 8 }, { total: 0, successCount: 0 })).toBeNull();
  });
});
