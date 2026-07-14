/** 将字节数格式化为人类可读字符串（B/KB/MB/GB/TB），无效或非正值返回 '0 B' */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.max(Math.floor(Math.log2(bytes) / 10), 0), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
