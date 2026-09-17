import { isScheduleTime, scheduleTimeToMinutes } from './constants';

export interface ScheduledDarkConfig {
  readonly scheduledDarkMode: 'off' | 'custom';
  readonly scheduledDarkStart: string;
  readonly scheduledDarkEnd: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 当前时刻是否落在深色窗口内。窗口可跨午夜（结束早于开始表示次日）；
 * 起止相同视为空窗口，非法时刻一律视为关闭。
 */
export function isInDarkWindow(now: Date, start: string, end: string): boolean {
  if (!isScheduleTime(start) || !isScheduleTime(end)) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const from = scheduleTimeToMinutes(start);
  const to = scheduleTimeToMinutes(end);
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/**
 * 定时深色当前是否生效。关闭模式、非法时刻、空窗口都返回 false；
 * 生效时无条件使用深色，调用方不再看颜色模式（时段外才跟随颜色模式）。
 */
export function isScheduledDarkNow(config: ScheduledDarkConfig, now: Date = new Date()): boolean {
  if (config.scheduledDarkMode !== 'custom') return false;
  return isInDarkWindow(now, config.scheduledDarkStart, config.scheduledDarkEnd);
}

/**
 * 距下一次窗口边界的毫秒数（供定时器一次打到边界）。无有效窗口时返回 null；
 * 恰好落在边界毫秒上时返回下一边界，避免 0 延迟空转。
 */
export function msUntilScheduleBoundary(config: ScheduledDarkConfig, now: Date = new Date()): number | null {
  if (config.scheduledDarkMode !== 'custom') return null;
  if (!isScheduleTime(config.scheduledDarkStart) || !isScheduleTime(config.scheduledDarkEnd)) return null;
  const from = scheduleTimeToMinutes(config.scheduledDarkStart);
  const to = scheduleTimeToMinutes(config.scheduledDarkEnd);
  if (from === to) return null;
  // 本地时刻（边界按本地时钟解释，不能用 getTime 取模 UTC 午夜）
  const elapsed = ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds();
  const deltas = [from, to].map((minutes) => {
    const delta = (minutes * 60 * 1000 - elapsed + DAY_MS) % DAY_MS;
    return delta === 0 ? DAY_MS : delta;
  });
  return Math.min(...deltas);
}
