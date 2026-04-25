import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatFileTimestamp,
  formatNullableDateTime,
  isDateTimeString,
  parseDateRangeEnd,
  parseDateRangeStart,
  parseDateTimeInput,
} from './datetime';

describe('datetime utilities', () => {
  it('formats Date as unified date-time string', () => {
    expect(formatDateTime(new Date(2026, 2, 22, 20, 9, 37))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:09:37$/);
  });

  it('keeps unified date-time string format stable', () => {
    expect(formatDateTime('2026-03-22 20:09:37')).toBe('2026-03-22 20:09:37');
  });

  it('returns null for nullable empty values', () => {
    expect(formatNullableDateTime(null)).toBeNull();
    expect(formatNullableDateTime(undefined)).toBeNull();
  });

  it('formats date and file timestamp', () => {
    expect(formatDate('2026-03-22 20:09:37')).toBe('2026-03-22');
    expect(formatFileTimestamp('2026-03-22 20:09:37')).toBe('20260322_200937');
  });

  it('parses unified date-time inputs', () => {
    const parsed = parseDateTimeInput('2026-03-22 20:09:37');
    expect(parsed).toBeInstanceOf(Date);
    if (!parsed) throw new Error('Expected parsed date');
    expect(formatDateTime(parsed)).toBe('2026-03-22 20:09:37');
  });

  it('expands date-only range boundaries', () => {
    const start = parseDateRangeStart('2026-03-22');
    const end = parseDateRangeEnd('2026-03-22');
    if (!start || !end) throw new Error('Expected date range boundaries');
    expect(formatDateTime(start)).toBe('2026-03-22 00:00:00');
    expect(formatDateTime(end)).toBe('2026-03-22 23:59:59');
  });

  it('detects unified date-time strings', () => {
    expect(isDateTimeString('2026-03-22 20:09:37')).toBe(true);
    expect(isDateTimeString('2026-03-22')).toBe(false);
  });
});
