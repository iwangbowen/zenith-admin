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
