import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const DATE_FORMAT = 'YYYY-MM-DD';

const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
type DateInput = Date | string | number | null | undefined;
type DefinedDateInput = Exclude<DateInput, null | undefined>;
type DateRangeInput = readonly DateInput[] | null | undefined;

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

export function formatDateTimeRangeValuesForApi(
  range: readonly [DefinedDateInput, DefinedDateInput],
): [string, string];
export function formatDateTimeRangeValuesForApi(
  range: DateRangeInput,
  emptyValue: string,
): [string, string];
export function formatDateTimeRangeValuesForApi(
  range: DateRangeInput,
): [string | undefined, string | undefined];
export function formatDateTimeRangeValuesForApi(
  range: DateRangeInput,
  emptyValue?: string,
): [string | undefined, string | undefined] {
  const formatBound = (value: DateInput) =>
    value == null ? emptyValue : formatDateTimeForApi(value);
  return [formatBound(range?.[0]), formatBound(range?.[1])];
}

export function formatDateTimeRangeForApi(
  range: readonly [DefinedDateInput, DefinedDateInput],
): { startTime: string; endTime: string };
export function formatDateTimeRangeForApi(
  range: DateRangeInput,
): { startTime: string | undefined; endTime: string | undefined };
export function formatDateTimeRangeForApi(
  range: DateRangeInput,
): { startTime: string | undefined; endTime: string | undefined } {
  if (!range) return { startTime: undefined, endTime: undefined };
  const [startTime, endTime] = formatDateTimeRangeValuesForApi(range, '');
  return { startTime, endTime };
}

/**
 * 格式化接口提交用日期，禁止 toISOString().slice(0, 10) 造成日期偏移。
 */
export function formatDateForApi(date: DateInput): string {
  return formatDate(date);
}

/**
 * 剥离 HTML 标签，返回纯文本摘要，用于列表/通知摘要场景。
 *
 * 必须用 DOMParser 解析：它产出的是惰性文档，不加载资源也不执行脚本；
 * 若改用 `div.innerHTML = html`，`<img src=x onerror=…>` 在分离元素上解析时同样会触发。
 */
export function stripHtml(html: string | null | undefined, maxLength = 100): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // 脚本 / 样式的源码不是正文，不应出现在摘要里
  for (const el of doc.querySelectorAll('script, style, template, noscript')) el.remove();
  const text = (doc.body?.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
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

/**
 * 相对当前时刻的粗粒度表述：过去 →「刚刚 / N 分钟前 / N 小时前 / N 天前」，未来 →「N 秒后 / N 分钟后 / …」。
 * 适合「最近执行」「下次执行」这类需要一眼看出远近的场景；精确时刻由调用方另行以 tooltip 或相邻文本给出。
 * 入参为空 / 非法时返回空串。
 */
export function formatRelativeTime(date: DateInput, now: DateInput = new Date()): string {
  if (!date) return '';
  const d = dayjs(typeof date === 'string' ? date.replace(' ', 'T') : date);
  const base = dayjs(typeof now === 'string' ? now.replace(' ', 'T') : now);
  if (!d.isValid() || !base.isValid()) return '';
  const diffSec = Math.round(d.diff(base) / 1000);
  const abs = Math.abs(diffSec);
  const suffix = diffSec < 0 ? '前' : '后';
  if (abs < 10 && diffSec <= 0) return '刚刚';
  if (abs < 60) return `${abs} 秒${suffix}`;
  if (abs < 3600) return `${Math.floor(abs / 60)} 分钟${suffix}`;
  if (abs < 86400) return `${Math.floor(abs / 3600)} 小时${suffix}`;
  return `${Math.floor(abs / 86400)} 天${suffix}`;
}
