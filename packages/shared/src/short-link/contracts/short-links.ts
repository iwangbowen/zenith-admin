import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeBound, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { SHORT_LINK_BIZ_TYPES, SHORT_LINK_REDIRECT_TYPES, SHORT_LINK_STATS_MAX_DAYS } from '../constants';
import {
  batchUpdateShortLinkStatusSchema,
  createShortLinkSchema,
  ensureShortLinkSchema,
  updateShortLinkSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const shortLinkSchema = z.object({
  id: z.int(),
  code: z.string().meta({ example: 'aB3xY7k' }),
  shortUrl: z.string().meta({ description: '完整短链地址（服务端按 PUBLIC_BASE_URL 拼装）', example: 'https://example.com/s/aB3xY7k' }),
  targetUrl: z.string().meta({ example: 'https://example.com/landing?from=sms' }),
  title: z.string().nullable(),
  redirectType: z.enum(SHORT_LINK_REDIRECT_TYPES),
  status: entityStatusSchema,
  expiresAt: z.string().nullable().meta({ description: 'YYYY-MM-DD HH:mm:ss；null = 永久有效' }),
  expired: z.boolean().meta({ description: '是否已过期（服务端按当前时间计算）' }),
  maxVisits: z.int().nullable(),
  password: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  utmTerm: z.string().nullable(),
  utmContent: z.string().nullable(),
  bizType: z.enum(SHORT_LINK_BIZ_TYPES),
  bizRef: z.string().nullable(),
  remark: z.string().nullable(),
  totalPv: z.int(),
  lastVisitAt: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ShortLink' });

export type ShortLink = z.infer<typeof shortLinkSchema>;

// ─── 访问统计 ────────────────────────────────────────────────────────────────

export const shortLinkTrendPointSchema = z.object({
  date: z.string().meta({ description: 'YYYY-MM-DD' }),
  pv: z.int(),
  uv: z.int(),
}).meta({ id: 'ShortLinkTrendPoint' });

export type ShortLinkTrendPoint = z.infer<typeof shortLinkTrendPointSchema>;

export const shortLinkDimensionItemSchema = z.object({
  name: z.string(),
  count: z.int(),
}).meta({ id: 'ShortLinkDimensionItem' });

export type ShortLinkDimensionItem = z.infer<typeof shortLinkDimensionItemSchema>;

export const shortLinkStatsSchema = z.object({
  totals: z.object({
    pv: z.int(),
    uv: z.int(),
    todayPv: z.int(),
    todayUv: z.int(),
  }),
  trend: z.array(shortLinkTrendPointSchema),
  devices: z.array(shortLinkDimensionItemSchema),
  browsers: z.array(shortLinkDimensionItemSchema),
  regions: z.array(shortLinkDimensionItemSchema),
  referers: z.array(shortLinkDimensionItemSchema),
}).meta({ id: 'ShortLinkStats' });

export type ShortLinkStats = z.infer<typeof shortLinkStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const shortLinkListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按短码 / 标题 / 目标地址模糊匹配' }),
  status: entityStatusQuery,
  bizType: queryEnum(SHORT_LINK_BIZ_TYPES),
  startTime: dateRangeBound('创建时间起'),
  endTime: dateRangeBound('创建时间止'),
});

export const shortLinkStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(SHORT_LINK_STATS_MAX_DAYS).optional().meta({ description: '统计窗口天数，默认 30' }),
});

export const shortLinkContract = defineContract('/api/short-links', {
  list: op.get('/', { query: shortLinkListQuery, response: paginated(shortLinkSchema), summary: '短链列表' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除短链' }),
  batchUpdateStatus: op.put('/batch/status', { body: batchUpdateShortLinkStatusSchema, summary: '批量启用/禁用短链' }),
  ensure: op.post('/ensure', {
    body: ensureShortLinkSchema,
    response: shortLinkSchema,
    summary: '为业务对象幂等获取短链（同 bizType+bizRef 复用）',
  }),
  detail: op.get('/{id}', { params: idParam, response: shortLinkSchema, summary: '获取短链详情' }),
  stats: op.get('/{id}/stats', {
    params: idParam,
    query: shortLinkStatsQuery,
    response: shortLinkStatsSchema,
    summary: '短链访问统计（趋势/设备/地域/来源）',
  }),
  create: op.post('/', { body: createShortLinkSchema, response: shortLinkSchema, summary: '创建短链' }),
  update: op.put('/{id}', { params: idParam, body: updateShortLinkSchema, response: shortLinkSchema, summary: '更新短链' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除短链' }),
}, { tags: ['短链管理'] });
