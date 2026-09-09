import { describe, expect, it } from 'vitest';
import { formatClock, formatDurationMs, formatSecondsBetween, formatSecondsHuman } from './format';

describe('formatDurationMs', () => {
  it('按量级切换单位，空值返回占位符', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(850)).toBe('850 ms');
    expect(formatDurationMs(1500)).toBe('1.5 s');
    expect(formatDurationMs(90_000)).toBe('1.5 min');
  });
});

describe('formatSecondsHuman', () => {
  it('不足 1 分钟显示秒', () => {
    expect(formatSecondsHuman(0)).toBe('0秒');
    expect(formatSecondsHuman(45.9)).toBe('45秒');
  });

  it('满 1 分钟起省略秒，省略为 0 的单位，无空格', () => {
    expect(formatSecondsHuman(60)).toBe('1分');
    expect(formatSecondsHuman(3 * 86400 + 2 * 3600 + 5 * 60 + 7)).toBe('3天2小时5分');
    expect(formatSecondsHuman(3 * 86400 + 5 * 60)).toBe('3天5分');
    expect(formatSecondsHuman(2 * 3600)).toBe('2小时');
  });

  it('空值 / 非法值返回占位符，负数按 0 处理', () => {
    expect(formatSecondsHuman(null)).toBe('—');
    expect(formatSecondsHuman(undefined)).toBe('—');
    expect(formatSecondsHuman(Number.NaN)).toBe('—');
    expect(formatSecondsHuman(-30)).toBe('0秒');
  });
});

describe('formatSecondsBetween', () => {
  it('按两个时刻的秒差格式化，终点早于起点按 0', () => {
    expect(formatSecondsBetween('2026-08-01 10:00:00', '2026-08-01 12:05:00')).toBe('2小时5分');
    expect(formatSecondsBetween('2026-08-01 10:00:00', '2026-08-01 09:00:00')).toBe('0秒');
  });
});

describe('formatClock', () => {
  it('mm:ss 补零，满 1 小时前置小时，空值 00:00', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3600 + 5 * 60 + 3)).toBe('1:05:03');
    expect(formatClock(null)).toBe('00:00');
  });
});
