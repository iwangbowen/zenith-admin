import dayjs from 'dayjs';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

/** 毫秒时长格式化（ms → s → min），空值返回占位符：适合任务 / 调度 / 接口耗时展示 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return EMPTY_PLACEHOLDER;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/**
 * 秒级时长 → 人读中文：「3天2小时5分」。省略为 0 的单位，不足 1 分钟才显示秒（`45秒`），空值返回占位符。
 * 适合运行时长、等待时长、维护窗口等分钟级以上的展示；播放器 / 通话计时用 `formatClock`。
 */
export function formatSecondsHuman(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return EMPTY_PLACEHOLDER;
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}秒`;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  return parts.join('');
}

/** 服务 / 数据库运行时长：`formatSecondsHuman` 口径；0 或负值视为未知，返回占位符 */
export function formatUptime(seconds: number | null | undefined): string {
  return seconds != null && seconds > 0 ? formatSecondsHuman(seconds) : EMPTY_PLACEHOLDER;
}

/** 两个 `YYYY-MM-DD HH:mm:ss` 时刻之间的时长（`formatSecondsHuman` 口径），终点早于起点按 0 处理 */
export function formatSecondsBetween(start: string | Date, end: string | Date): string {
  return formatSecondsHuman(Math.max(0, dayjs(end).diff(dayjs(start), 'second')));
}

/** 秒 → 计时器样式 `mm:ss`（满 1 小时为 `h:mm:ss`），空值显示 `00:00`：通话计时、录屏 / 音视频时长 */
export function formatClock(seconds: number | null | undefined): string {
  const total = seconds == null || !Number.isFinite(seconds) ? 0 : Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
