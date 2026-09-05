import * as z from 'zod';

/** `days` 窗口参数（最近 N 天） */
export function daysQuery(max: number, defaultDays: number, description = '统计窗口（天）') {
  return z.coerce.number().int().min(1).max(max).default(defaultDays).meta({ description, example: defaultDays });
}

/** 纯日期端点（YYYY-MM-DD） */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD');

/** 站点 Key 查询参数：匿名采集时用于归属租户；与 `X-Analytics-Site-Key` 请求头等价 */
export const siteKeyQueryField = z.string().optional().meta({ description: '站点 Key（与 X-Analytics-Site-Key 请求头等价）' });
