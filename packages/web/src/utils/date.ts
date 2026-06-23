import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const DATE_FORMAT = 'YYYY-MM-DD';

const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
type DateInput = Date | string | number | null | undefined;

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm:ss
 */
export function formatDateTime(date: DateInput): string {
  if (!date) return '';
  if (typeof date === 'string' && DATE_TIME_PATTERN.test(date)) {
    return dayjs(date, DATE_TIME_FORMAT, true).format(DATE_TIME_FORMAT);
  }
  return dayjs(date).format(DATE_TIME_FORMAT);
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: DateInput): string {
  if (!date) return '';
  return dayjs(date).format(DATE_FORMAT);
}

/**
 * 格式化接口提交用日期时间，禁止直接使用 toISOString() 造成时区偏移。
 */
export function formatDateTimeForApi(date: DateInput): string {
  return formatDateTime(date);
}

/**
 * 格式化接口提交用日期，禁止 toISOString().slice(0, 10) 造成日期偏移。
 */
export function formatDateForApi(date: DateInput): string {
  return formatDate(date);
}

/**
 * 剥离 HTML 标签，返回纯文本摘要，用于列表/通知摘要场景
 */
export function stripHtml(html: string | null | undefined, maxLength = 100): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const text = (div.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * 会话列表时间智能格式：
 *  - 今天          → HH:mm
 *  - 今年内（非今天）→ MM-DD HH:mm
 *  - 跨年          → YYYY-MM-DD
 */
export function formatConvTime(date: DateInput): string {
  if (!date) return '';
  const d = dayjs(typeof date === 'string' ? date.replace(' ', 'T') : date);
  if (!d.isValid()) return '';
  const now = dayjs();
  if (d.isSame(now, 'day')) return d.format('HH:mm');
  if (d.isSame(now, 'year')) return d.format('MM-DD HH:mm');
  return d.format('YYYY-MM-DD');
}

/**
 * 计算两个时间点之间的耗时，返回中文人类可读字符串（如「2小时11分」「5分钟」「45秒」）。
 * 入参为空 / 非法 / 结束早于开始时返回空串。
 */
export function formatDurationBetween(start: DateInput, end: DateInput): string {
  if (!start || !end) return '';
  const s = dayjs(typeof start === 'string' ? start.replace(' ', 'T') : start);
  const e = dayjs(typeof end === 'string' ? end.replace(' ', 'T') : end);
  if (!s.isValid() || !e.isValid()) return '';
  const ms = e.diff(s);
  if (ms < 0) return '';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}分钟`;
  const totalHour = Math.floor(totalMin / 60);
  if (totalHour < 24) {
    const min = totalMin % 60;
    return min > 0 ? `${totalHour}小时${min}分` : `${totalHour}小时`;
  }
  const day = Math.floor(totalHour / 24);
  const hour = totalHour % 24;
  return hour > 0 ? `${day}天${hour}小时` : `${day}天`;
}
