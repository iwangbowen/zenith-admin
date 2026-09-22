/**
 * 首页图表下钻的目标地址。
 *
 * 参数名与列表页的筛选字段同名（`status` / `startTime` / `endTime` / `module`），
 * 目标页用 `useListDeepLink` 消费（一次性，消费后即从地址栏移除），
 * 因此下钻条件对用户可见、可核对，也不与页面自身的筛选状态抢 URL。
 */
import dayjs from 'dayjs';
import { formatDate, formatDateTimeRangeForApi } from '@/utils/date';

/** 登录趋势的系列：图表配色、系列名与下钻用的登录日志状态同源，避免两处各写一份映射 */
export const LOGIN_TREND_SERIES = [
  { field: 'successCount', name: '成功', status: 'success', color: '#52C41A' },
  { field: 'failCount', name: '失败', status: 'fail', color: '#F5222D' },
] as const;

export type LoginTrendStatus = (typeof LOGIN_TREND_SERIES)[number]['status'];

const LOGIN_STATUS_BY_SERIES_NAME = new Map<string, LoginTrendStatus>(
  LOGIN_TREND_SERIES.map((series) => [series.name, series.status]),
);

/** 某天的自然日区间（本地时区）→ 契约标准时间端点，与列表页时间范围筛选的取值一致 */
function dayRangeParams(date: string): { startTime: string; endTime: string } {
  return formatDateTimeRangeForApi([
    dayjs(date).startOf('day').toDate(),
    dayjs(date).endOf('day').toDate(),
  ]);
}

/**
 * 登录趋势某天某条线的下钻地址：`/system/login-logs?status=…&startTime=…&endTime=…`。
 * 时间取所点那天的自然日区间。
 */
export function loginLogsDrillUrl(date: string, seriesName: string): string {
  const params = new URLSearchParams(dayRangeParams(date));
  const status = LOGIN_STATUS_BY_SERIES_NAME.get(seriesName);
  if (status) params.set('status', status);
  return `/system/login-logs?${params.toString()}`;
}

/**
 * 操作分布某个模块扇区的下钻地址：`/system/operation-logs?module=…&startTime=…&endTime=…`。
 * 图表口径是「今日」，列表必须跟着带上今天的自然日区间——只带模块的话，
 * 点开的是该模块的全部历史记录，与扇区上看到的数量对不上。
 */
export function operationLogsDrillUrl(module: string, date: string = formatDate(new Date())): string {
  return `/system/operation-logs?${new URLSearchParams({ module, ...dayRangeParams(date) }).toString()}`;
}
