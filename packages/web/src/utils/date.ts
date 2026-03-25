import dayjs from 'dayjs';

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm:ss
 */
export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return '';
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
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
