import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import {
  APP_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatFileTimestamp,
  formatNullableDateTime,
  formatTimestamps,
  isDateTimeString,
  parseDateRangeEnd,
  parseDateRangeStart,
  parseDateTimeInput,
  resolveStatsWindow,
  startOfDayAgo,
  startOfRecentDays,
  startOfToday,
} from './datetime';

dayjs.extend(utc);
dayjs.extend(timezone);

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

  it('formatTimestamps 只映射 createdAt / updatedAt 两列，可展开进 mapXxx', () => {
    const row = { id: 1, name: 'x', createdAt: '2026-03-22 20:09:37', updatedAt: new Date(2026, 2, 23, 8, 0, 0) };
    expect(formatTimestamps(row)).toEqual({ createdAt: '2026-03-22 20:09:37', updatedAt: formatDateTime(row.updatedAt) });
    expect(Object.keys(formatTimestamps(row))).toEqual(['createdAt', 'updatedAt']);
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

  it('Intl 快路径与 dayjs.tz 路径逐字符一致（Date / 时间戳输入）', () => {
    // 覆盖 1970–2100 随机时刻与整点边界（含午夜：hourCycle h23 必须输出 00 而非 24）
    const samples: Date[] = [];
    let seed = 20260903;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 1500; i++) samples.push(new Date(Math.floor(rand() * 4_102_444_800_000)));
    for (let d = 0; d < 40; d++) samples.push(new Date(Date.UTC(2026, 0, 1 + d * 9, 16, 0, 0)));
    for (const date of samples) {
      const ref = dayjs(date).tz(APP_TIME_ZONE);
      expect(formatDateTime(date)).toBe(ref.format('YYYY-MM-DD HH:mm:ss'));
      expect(formatDateTime(date.getTime())).toBe(ref.format('YYYY-MM-DD HH:mm:ss'));
      expect(formatDate(date)).toBe(ref.format('YYYY-MM-DD'));
      expect(formatFileTimestamp(date)).toBe(ref.format('YYYYMMDD_HHmmss'));
    }
  });

  it('Invalid Date 回落 dayjs 语义', () => {
    expect(formatDateTime(new Date(NaN))).toBe(dayjs(new Date(NaN)).tz(APP_TIME_ZONE).format('YYYY-MM-DD HH:mm:ss'));
  });

  describe('本地日界与统计窗口', () => {
    const localMidnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;

    it('startOfToday 为进程本地时区的今日 00:00:00.000', () => {
      const today = startOfToday();
      const now = new Date();
      expect(localMidnight(today)).toBe(true);
      expect(today.getFullYear()).toBe(now.getFullYear());
      expect(today.getMonth()).toBe(now.getMonth());
      expect(today.getDate()).toBe(now.getDate());
    });

    it('startOfDayAgo / startOfRecentDays 按本地日历回推并保持 00:00', () => {
      const today = startOfToday();
      const expected = new Date(today);
      expected.setDate(expected.getDate() - 6);
      expect(startOfDayAgo(6).getTime()).toBe(expected.getTime());
      expect(startOfRecentDays(7).getTime()).toBe(expected.getTime());
      expect(startOfDayAgo(0).getTime()).toBe(today.getTime());
      expect(localMidnight(startOfRecentDays(30))).toBe(true);
    });

    it('resolveStatsWindow 夹紧天数并给出本期 / 上期起点', () => {
      expect(resolveStatsWindow(undefined).days).toBe(90);
      expect(resolveStatsWindow('abc').days).toBe(90);
      expect(resolveStatsWindow(1).days).toBe(7);
      expect(resolveStatsWindow(9999).days).toBe(365);
      expect(resolveStatsWindow(3, { fallback: 30, min: 1, max: 90 }).days).toBe(3);

      const win = resolveStatsWindow(30);
      expect(win.startDate.getTime()).toBe(startOfRecentDays(30).getTime());
      expect(win.startDateLabel).toBe(formatDate(win.startDate));
      const prev = new Date(win.startDate);
      prev.setDate(prev.getDate() - 30);
      expect(win.prevStartDate.getTime()).toBe(prev.getTime());
    });
  });
});
