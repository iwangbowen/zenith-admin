/** 终端录屏：容量 / 时长格式化工具 */

/** 字节格式化为人类可读（B/KB/MB/GB/TB）。 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

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
