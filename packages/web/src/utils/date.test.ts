import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  formatDate,
  formatDateForApi,
  formatDateRangeForApi,
  formatDateRangeValuesForApi,
  formatDateTime,
  formatDateTimeForApi,
  formatDateTimeRangeForApi,
  formatDateTimeRangeValuesForApi,
  shortDate,
  stripHtml,
} from './date';

describe('shortDate', () => {
  it('YYYY-MM-DD → MM-DD，短串原样返回', () => {
    expect(shortDate('2026-09-11')).toBe('09-11');
    expect(shortDate('2026-09-11 08:00:00')).toBe('09-11 08:00:00');
    expect(shortDate('9-11')).toBe('9-11');
    expect(shortDate('')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('should return empty string for null/undefined', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });

  it('should keep unified date-time string', () => {
    expect(formatDateTime('2025-03-15 14:30:00')).toBe('2025-03-15 14:30:00');
  });

  it('should format Date object', () => {
    const d = new Date(2025, 0, 1, 0, 0, 0);
    const result = formatDateTime(d);
    expect(result).toBe('2025-01-01 00:00:00');
  });

  it('should format timestamp number', () => {
    const ts = new Date(2025, 5, 1, 12, 0, 0).getTime();
    const result = formatDateTime(ts);
    expect(result).toBe('2025-06-01 12:00:00');
  });

  it('should format date only string', () => {
    expect(formatDate('2025-06-01 12:00:00')).toBe('2025-06-01');
  });

  it('should format API date-time without timezone conversion', () => {
    const date = new Date(2026, 2, 22, 20, 9, 37);
    expect(formatDateTimeForApi(date)).toBe('2026-03-22 20:09:37');
  });

  it('should format an API date-time range without timezone conversion', () => {
    const range = [
      new Date(2026, 2, 22, 20, 9, 37),
      new Date(2026, 2, 23, 8, 5, 2),
    ] as const;

    expect(formatDateTimeRangeForApi(range)).toEqual({
      startTime: '2026-03-22 20:09:37',
      endTime: '2026-03-23 08:05:02',
    });
  });

  it('should preserve undefined API range bounds when no range is selected', () => {
    expect(formatDateTimeRangeForApi(null)).toEqual({
      startTime: undefined,
      endTime: undefined,
    });
  });

  it('should support partial ranges and custom empty values', () => {
    const start = new Date(2026, 2, 22, 20, 9, 37);

    expect(formatDateTimeRangeValuesForApi([start])).toEqual([
      '2026-03-22 20:09:37',
      undefined,
    ]);
    expect(formatDateTimeRangeValuesForApi(null, '')).toEqual(['', '']);
    expect(formatDateTimeRangeForApi([start])).toEqual({
      startTime: '2026-03-22 20:09:37',
      endTime: '',
    });
  });

  it('should format API date without timezone conversion', () => {
    const date = new Date(2026, 2, 22, 20, 9, 37);
    expect(formatDateForApi(date)).toBe('2026-03-22');
  });

  it('should format a date-level range as YYYY-MM-DD bounds with undefined for unselected ends', () => {
    const start = new Date(2026, 2, 22, 20, 9, 37);
    const end = new Date(2026, 2, 23, 8, 5, 2);
    expect(formatDateRangeValuesForApi([start, end])).toEqual(['2026-03-22', '2026-03-23']);
    expect(formatDateRangeValuesForApi([start])).toEqual(['2026-03-22', undefined]);
    expect(formatDateRangeValuesForApi(null)).toEqual([undefined, undefined]);
    expect(formatDateRangeForApi([start, end])).toEqual({ startTime: '2026-03-22', endTime: '2026-03-23' });
    expect(formatDateRangeForApi(undefined)).toEqual({ startTime: undefined, endTime: undefined });
    // 已定义的元组得到非可选字符串，必选区间的调用方无需再做空值判断
    expectTypeOf(formatDateRangeValuesForApi([start, end] as const)).toEqualTypeOf<[string, string]>();
    expectTypeOf(formatDateRangeForApi([start, end] as const)).toEqualTypeOf<{ startTime: string; endTime: string }>();
  });
});

describe('stripHtml', () => {
  it('应该剥离简单HTML标签', () => {
    expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
  });

  it('对于 null 应该返回空字符', () => {
    expect(stripHtml(null)).toBe('');
  });

  it('对于 undefined 应该返回空字符', () => {
    expect(stripHtml(undefined)).toBe('');
  });

  it('应该把复杂tag当做文本剥离', () => {
    expect(stripHtml('<div>content</div><span>more</span>')).toBe('contentmore');
  });

  it('超过 maxLength 应该被截断', () => {
    const text = 'a'.repeat(200);
    expect(stripHtml(`<p>${text}</p>`, 10)).toBe('aaaaaaaaaa...');
  });

  it('应该规范化空格', () => {
    expect(stripHtml('<p>hello   world \n test</p>')).toBe('hello world test');
  });

  it('未超过 max length 时返回完整字符串', () => {
    expect(stripHtml('<p>hello</p>', 100)).toBe('hello');
  });

  it('解析恶意 HTML 时不执行脚本、不触发事件处理器（惰性 DOMParser 文档）', () => {
    const marker = '__zenith_strip_html_xss__';
    (globalThis as Record<string, unknown>)[marker] = false;
    const text = stripHtml(`<img src=x onerror="globalThis['${marker}']=true"><script>globalThis['${marker}']=true</script>safe`);
    expect(text).toBe('safe');
    expect((globalThis as Record<string, unknown>)[marker]).toBe(false);
    delete (globalThis as Record<string, unknown>)[marker];
  });
});
