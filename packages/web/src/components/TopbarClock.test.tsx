import { describe, expect, it } from 'vitest';
import { formatTopbarClock } from './TopbarClock';

describe('formatTopbarClock', () => {
  it('24 小时制带日期', () => {
    // 2026-09-17 是周四
    expect(formatTopbarClock(new Date(2026, 8, 17, 14, 5), '24h', true)).toBe('9月17日 周四 14:05');
  });

  it('12 小时制用上午下午且小时不补零', () => {
    expect(formatTopbarClock(new Date(2026, 8, 17, 14, 5), '12h', false)).toBe('下午2:05');
    expect(formatTopbarClock(new Date(2026, 8, 17, 0, 5), '12h', false)).toBe('上午12:05');
    expect(formatTopbarClock(new Date(2026, 8, 17, 12, 0), '12h', false)).toBe('下午12:00');
  });
});
