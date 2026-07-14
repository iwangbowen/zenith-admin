/** 终端录屏：容量 / 时长格式化工具 */

export { formatBytes } from '@/utils/format';

/** 列表用：紧凑时长（如 1m 5s）。 */
export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** 统计用：累计时长（如 3 小时 12 分）。 */
export function formatDurationLong(secs: number): string {
  if (!secs || secs <= 0) return '0 秒';
  if (secs < 60) return `${Math.floor(secs)} 秒`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}
