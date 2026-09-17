import { describe, expect, it } from 'vitest';
import { isInDarkWindow, isScheduledDarkNow, msUntilScheduleBoundary } from './schedule';

function at(hours: number, minutes = 0, seconds = 0): Date {
  const date = new Date(2026, 8, 17, hours, minutes, seconds);
  date.setMilliseconds(0);
  return date;
}

describe('定时深色窗口判定', () => {
  it('同日窗口：起闭区间左闭右开', () => {
    expect(isInDarkWindow(at(9, 0), '09:00', '18:00')).toBe(true);
    expect(isInDarkWindow(at(8, 59), '09:00', '18:00')).toBe(false);
    expect(isInDarkWindow(at(18, 0), '09:00', '18:00')).toBe(false);
  });

  it('跨午夜窗口：结束早于开始表示次日', () => {
    expect(isInDarkWindow(at(23, 30), '18:00', '06:00')).toBe(true);
    expect(isInDarkWindow(at(0, 0), '18:00', '06:00')).toBe(true);
    expect(isInDarkWindow(at(5, 59), '18:00', '06:00')).toBe(true);
    expect(isInDarkWindow(at(6, 0), '18:00', '06:00')).toBe(false);
    expect(isInDarkWindow(at(12, 0), '18:00', '06:00')).toBe(false);
  });

  it('起止相同视为空窗口，非法时刻一律关闭', () => {
    expect(isInDarkWindow(at(12, 0), '18:00', '18:00')).toBe(false);
    expect(isInDarkWindow(at(12, 0), '18:0', '06:00')).toBe(false);
    expect(isInDarkWindow(at(12, 0), '18:00', '25:00')).toBe(false);
  });

  it('关闭模式直接返回 false', () => {
    expect(isScheduledDarkNow({ scheduledDarkMode: 'off', scheduledDarkStart: '00:00', scheduledDarkEnd: '23:59' }, at(12, 0))).toBe(false);
    expect(isScheduledDarkNow({ scheduledDarkMode: 'custom', scheduledDarkStart: '18:00', scheduledDarkEnd: '06:00' }, at(23, 0))).toBe(true);
  });
});

describe('窗口边界定时器', () => {
  it('返回距下一边界的毫秒数', () => {
    const config = { scheduledDarkMode: 'custom' as const, scheduledDarkStart: '18:00', scheduledDarkEnd: '06:00' };
    expect(msUntilScheduleBoundary(config, at(17, 0))).toBe(60 * 60 * 1000);
    expect(msUntilScheduleBoundary(config, at(23, 0))).toBe(7 * 60 * 60 * 1000);
  });

  it('无有效窗口时返回 null', () => {
    expect(msUntilScheduleBoundary({ scheduledDarkMode: 'off', scheduledDarkStart: '18:00', scheduledDarkEnd: '06:00' }, at(12, 0))).toBeNull();
    expect(msUntilScheduleBoundary({ scheduledDarkMode: 'custom', scheduledDarkStart: '18:00', scheduledDarkEnd: '18:00' }, at(12, 0))).toBeNull();
    expect(msUntilScheduleBoundary({ scheduledDarkMode: 'custom', scheduledDarkStart: 'bad', scheduledDarkEnd: '06:00' }, at(12, 0))).toBeNull();
  });
});
