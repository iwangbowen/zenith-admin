import { describe, it, expect } from 'vitest';
import { formatDateTime } from './date';

describe('formatDateTime', () => {
  it('should return empty string for null/undefined', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });

  it('should format ISO string', () => {
    expect(formatDateTime('2025-03-15T14:30:00.000Z')).toMatch(/2025-03-15 \d{2}:30:00/);
  });

  it('should format Date object', () => {
    const d = new Date('2025-01-01T00:00:00.000Z');
    const result = formatDateTime(d);
    expect(result).toMatch(/2025-01-01/);
  });

  it('should format timestamp number', () => {
    const ts = new Date('2025-06-01T12:00:00Z').getTime();
    const result = formatDateTime(ts);
    expect(result).toMatch(/2025-06-01/);
  });
});
