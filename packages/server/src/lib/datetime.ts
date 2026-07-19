import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

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
  return toDayjsInAppTimezone(date).format(DATE_TIME_FORMAT);
}

export function currentDateTime(): string {
  return dayjs().tz(APP_TIME_ZONE).format(DATE_TIME_FORMAT);
}

export function formatNullableDateTime(date: NullableDateInput): string | null {
  if (!date) return null;
  return formatDateTime(date);
}

export function formatDate(date: DateInput): string {
  return toDayjsInAppTimezone(date).format(DATE_FORMAT);
}

export function formatFileTimestamp(date: DateInput = new Date()): string {
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
