import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const DATE_FORMAT = 'YYYY-MM-DD';
export const FILE_TIMESTAMP_FORMAT = 'YYYYMMDD_HHmmss';

const APP_TIME_ZONE = process.env.APP_TIME_ZONE || process.env.TZ || 'Asia/Shanghai';
export { APP_TIME_ZONE };
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
type DateInput = Date | string | number;
type NullableDateInput = DateInput | null | undefined;
type ParseDateInput = string | Date | null | undefined;

// ─── 快路径：Date / 时间戳 → 应用时区字段 ──────────────────────────────────────
// dayjs.tz() 每次调用都要重建 Intl 格式器并做多轮偏移换算（实测单次 ~1ms），在遥测接入这类
// 每帧都要格式化时间的热路径上是头号 CPU 项。这里复用一个 Intl.DateTimeFormat 直接取字段
// （formatToParts 约 10µs），输出与 dayjs 路径逐字符一致；字符串输入仍走 dayjs 解析。
interface ZonedParts { year: string; month: string; day: string; hour: string; minute: string; second: string }

let partsFormatter: Intl.DateTimeFormat | null | undefined;

function getPartsFormatter(): Intl.DateTimeFormat | null {
  if (partsFormatter !== undefined) return partsFormatter;
  try {
    partsFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    // 时区名 Intl 不识别时回落 dayjs（其错误语义保持原样）
    partsFormatter = null;
  }
  return partsFormatter;
}

function zonedParts(date: Date): ZonedParts | null {
  const formatter = getPartsFormatter();
  if (!formatter || Number.isNaN(date.getTime())) return null;
  const out: Partial<ZonedParts> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type as keyof ZonedParts] = part.value;
  }
  if (!out.year || !out.month || !out.day || !out.hour || !out.minute || !out.second) return null;
  return out as ZonedParts;
}

function toFastDate(date: DateInput): Date | null {
  if (date instanceof Date) return date;
  if (typeof date === 'number') return new Date(date);
  return null;
}

function toDayjsInAppTimezone(date: DateInput) {
  if (typeof date === 'string' && DATE_TIME_PATTERN.test(date)) {
    return dayjs.tz(date, DATE_TIME_FORMAT, APP_TIME_ZONE);
  }
  if (typeof date === 'string' && DATE_PATTERN.test(date)) {
    return dayjs.tz(date, DATE_FORMAT, APP_TIME_ZONE);
  }
  return dayjs(date).tz(APP_TIME_ZONE);
}

export function formatDateTime(date: DateInput): string {
  const fast = toFastDate(date);
  const parts = fast ? zonedParts(fast) : null;
  if (parts) return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  return toDayjsInAppTimezone(date).format(DATE_TIME_FORMAT);
}

export function currentDateTime(): string {
  return formatDateTime(new Date());
}

export function formatNullableDateTime(date: NullableDateInput): string | null {
  if (!date) return null;
  return formatDateTime(date);
}

export function formatDate(date: DateInput): string {
  const fast = toFastDate(date);
  const parts = fast ? zonedParts(fast) : null;
  if (parts) return `${parts.year}-${parts.month}-${parts.day}`;
  return toDayjsInAppTimezone(date).format(DATE_FORMAT);
}

export function formatFileTimestamp(date: DateInput = new Date()): string {
  const fast = toFastDate(date);
  const parts = fast ? zonedParts(fast) : null;
  if (parts) return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
  return toDayjsInAppTimezone(date).format(FILE_TIMESTAMP_FORMAT);
}

/**
 * ISO 8601（含时区偏移）格式化，仅用于对外协议标准强制要求 ISO 格式的场景
 * （如 SEO 结构化数据 JSON-LD、sitemap lastmod），常规 API 响应仍用 formatDateTime。
 */
export function formatIso8601(date: NullableDateInput): string | null {
  if (!date) return null;
  return toDayjsInAppTimezone(date).format('YYYY-MM-DDTHH:mm:ssZ');
}

export function parseDateTimeInput(value: ParseDateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (DATE_TIME_PATTERN.test(value)) {
    const parsed = dayjs.tz(value, DATE_TIME_FORMAT, APP_TIME_ZONE);
    return parsed.isValid() ? parsed.toDate() : null;
  }

  if (DATE_PATTERN.test(value)) {
    const parsed = dayjs.tz(`${value} 00:00:00`, DATE_TIME_FORMAT, APP_TIME_ZONE);
    return parsed.isValid() ? parsed.toDate() : null;
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toDate() : null;
}

export function parseDateRangeStart(value: ParseDateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (DATE_PATTERN.test(value)) {
    const parsed = dayjs.tz(value, DATE_FORMAT, APP_TIME_ZONE).startOf('day');
    return parsed.isValid() ? parsed.toDate() : null;
  }
  return parseDateTimeInput(value);
}

export function parseDateRangeEnd(value: ParseDateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (DATE_PATTERN.test(value)) {
    const parsed = dayjs.tz(value, DATE_FORMAT, APP_TIME_ZONE).endOf('day');
    return parsed.isValid() ? parsed.toDate() : null;
  }
  return parseDateTimeInput(value);
}

export function isDateTimeString(value: unknown): value is string {
  return typeof value === 'string' && DATE_TIME_PATTERN.test(value);
}

// ─── 本地日界（统计窗口起点）───────────────────────────────────────────────────
// 统计类 service 的「今日 / 近 N 天」窗口起点。刻意沿用进程本地时区的 setHours(0,0,0,0)
// 而非 APP_TIME_ZONE：与各统计口径此前的实现逐毫秒一致（部署时 TZ 与 APP_TIME_ZONE 应保持相同）。

/** 今日 00:00:00.000（进程本地时区）。 */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `daysAgo` 天前的 00:00:00.000（进程本地时区）；`startOfDayAgo(0)` 即今日起点。 */
export function startOfDayAgo(daysAgo: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

/** 「近 N 天（含今日）」窗口起点，即 `days - 1` 天前的 00:00:00。 */
export function startOfRecentDays(days: number): Date {
  return startOfDayAgo(days - 1);
}

export interface StatsWindow {
  /** 夹紧后的天数 */
  days: number;
  /** 本期起点：近 `days` 天（含今日）的 00:00:00 */
  startDate: Date;
  /** 本期起点的 `YYYY-MM-DD`，用于补齐空日序列的日期标签 */
  startDateLabel: string;
  /** 上一同长周期起点（环比），区间为 `[prevStartDate, startDate)` */
  prevStartDate: Date;
}

/**
 * 「近 N 天 + 上一同长周期」统计窗口（登录日志 / 操作日志统计等环比看板共用）。
 * `daysRaw` 非法或缺省取 `fallback`，并夹紧到 `[min, max]`。
 */
export function resolveStatsWindow(
  daysRaw: unknown,
  { fallback = 90, min = 7, max = 365 }: { fallback?: number; min?: number; max?: number } = {},
): StatsWindow {
  const days = Math.min(Math.max(Number(daysRaw) || fallback, min), max);
  const startDate = startOfRecentDays(days);
  return {
    days,
    startDate,
    startDateLabel: formatDate(startDate),
    prevStartDate: startOfDayAgo(2 * days - 1),
  };
}
