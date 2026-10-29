import { describe, expect, it } from 'vitest';
import type { ReportDataResult } from '@zenith/shared/report';
import { applyInMemoryQuery, governReportResult } from './report-result-processing';

const resultOf = (rows: Record<string, unknown>[]): ReportDataResult => ({ columns: ['value'], fields: [], rows, total: rows.length });
const limits = { datasetMaxRows: 5000, datasetMaxBytes: 2048 };

describe('report result budgets', () => {
  it('counts JSON bytes exactly, including UTF-8, escapes, nested and omitted values', () => {
    const input = resultOf([{ value: '中文😀\n"\\', nested: [null, { a: undefined, n: NaN }], at: new Date('2026-01-01T00:00:00Z') }]);
    const result = governReportResult(input, limits);
    expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(input.rows), 'utf8'));
    expect(result.rows).toBe(input.rows);
    expect(result.truncated).toBe(false);
    expect(governReportResult(resultOf([]), limits)).toMatchObject({ rows: [], bytes: 2, truncated: false });
  });

  it('retains the longest prefix that fits, with exact-boundary inclusion', () => {
    const rows = Array.from({ length: 20 }, (_, value) => ({ value, text: '中'.repeat(120) }));
    const budget = Buffer.byteLength(JSON.stringify(rows.slice(0, 3)));
    const result = governReportResult(resultOf(rows), { ...limits, datasetMaxBytes: budget });
    expect(result.rows).toEqual(rows.slice(0, 3));
    expect(result.bytes).toBe(budget);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(20);
    expect(result.truncatedReason).toContain('体积');
  });

  it('returns an empty array when the first row exceeds the byte budget', () => {
    const result = governReportResult(resultOf([{ value: 'x'.repeat(3000) }]), limits);
    expect(result).toMatchObject({ rows: [], bytes: 2, truncated: true, total: 1 });
  });

  it('applies row and byte budgets together and preserves prior truncation through cache round trips', () => {
    const input = resultOf(Array.from({ length: 10 }, (_, value) => ({ value, text: 'x'.repeat(700) })));
    const result = governReportResult(input, { ...limits, datasetMaxRows: 4 });
    expect(result.rows).toHaveLength(2);
    expect(result.truncatedReason).toContain('行数');
    expect(result.truncatedReason).toContain('体积');
    expect(governReportResult(JSON.parse(JSON.stringify(result)), limits)).toEqual(result);
  });

  it('does not serialize the unused tail after the budget is exceeded', () => {
    const rows = [{ value: 'x'.repeat(3000) }, { get value() { throw new Error('unused tail'); } }];
    expect(governReportResult(resultOf(rows), limits).rows).toEqual([]);
  });
});

describe('report in-memory queries', () => {
  it.each(['asc', 'desc'] as const)('preserves Chinese numeric collation and null-last %s sorting without mutating the snapshot', (sortOrder) => {
    const values = ['部门10', '部门2', '部门1', null, undefined, '北京', '上海'];
    const rows = values.map((value) => ({ value }));
    const expected = [...rows].sort((a, b) => {
      if (a.value === b.value) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return String(a.value).localeCompare(String(b.value), 'zh-CN', { numeric: true }) * (sortOrder === 'asc' ? 1 : -1);
    });
    expect(applyInMemoryQuery(rows, ['value'], { sortField: 'value', sortOrder }).rows).toEqual(expected);
    expect(rows.map((row) => row.value)).toEqual(values);
  });

  it('sorts numeric values numerically before slicing the requested page and preserves the total', () => {
    const rows = [10, null, -3, 2, 1].map((value) => ({ value }));
    expect(applyInMemoryQuery(rows, ['value'], { sortField: 'value', sortOrder: 'asc', page: 2, pageSize: 2 }, 100)).toEqual({
      columns: ['value'], rows: [{ value: 2 }, { value: 10 }], total: 100,
    });
    expect(applyInMemoryQuery(rows, ['value'], { page: 4, pageSize: 2 }).rows).toEqual([]);
    expect(() => applyInMemoryQuery(rows, ['value'], { sortField: 'missing' })).toThrow('排序字段不存在');
  });
});
