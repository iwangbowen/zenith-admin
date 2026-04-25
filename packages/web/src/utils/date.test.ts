import { describe, it, expect } from 'vitest';
import { formatDate, formatDateForApi, formatDateTime, formatDateTimeForApi, stripHtml } from './date';

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

  it('should format API date without timezone conversion', () => {
    const date = new Date(2026, 2, 22, 20, 9, 37);
    expect(formatDateForApi(date)).toBe('2026-03-22');
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
});
