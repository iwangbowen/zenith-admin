import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 公众号数据统计（本地聚合，近 7 日趋势） */
export const mpStatsSchema = z.object({
  fanTotal: z.int(),
  fanSubscribed: z.int(),
  fanUnsubscribed: z.int(),
  tagTotal: z.int(),
  materialTotal: z.int(),
  draftTotal: z.int(),
  messageIn: z.int(),
  messageOut: z.int(),
  autoReplyTotal: z.int(),
  fanTrend: z.array(z.object({ date: z.string(), count: z.int() })),
  messageTrend: z.array(z.object({ date: z.string(), in: z.int(), out: z.int() })),
}).meta({ id: 'MpStats' });

export type MpStats = z.infer<typeof mpStatsSchema>;

/** 微信数据立方（用户增减 / 累计、消息概况、图文阅读、分享、接口调用） */
export const mpDatacubeSchema = z.object({
  beginDate: z.string(),
  endDate: z.string(),
  userSummary: z.array(z.object({ refDate: z.string(), newUser: z.int(), cancelUser: z.int() })),
  userCumulate: z.array(z.object({ refDate: z.string(), cumulateUser: z.int() })),
  upstreamMsg: z.array(z.object({ refDate: z.string(), msgUser: z.int(), msgCount: z.int() })),
  articleSummary: z.array(z.object({ refDate: z.string(), pageReadCount: z.int() })),
  userShare: z.array(z.object({ refDate: z.string(), shareCount: z.int(), shareUser: z.int() })),
  interfaceSummary: z.array(z.object({
    refDate: z.string(),
    callbackCount: z.int(),
    failCount: z.int(),
    totalTimeCost: z.int(),
    maxTimeCost: z.int(),
  })),
}).meta({ id: 'MpDatacube' });

export type MpDatacube = z.infer<typeof mpDatacubeSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

const datacubeDate = (description: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD').meta({ description, example: '2026-08-01' });

export const mpDatacubeQuery = mpAccountIdQuery.extend({
  beginDate: datacubeDate('起始日期'),
  endDate: datacubeDate('结束日期'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpStatsContract = defineContract('/api/mp/stats', {
  overview: op.get('/', { query: mpAccountIdQuery, response: mpStatsSchema, summary: '数据统计' }),
  datacube: op.get('/datacube', {
    query: mpDatacubeQuery,
    response: mpDatacubeSchema,
    summary: '微信数据立方（真实接口）',
    description: '对接微信数据立方接口（用户增减/累计、消息概况、图文阅读），查询跨度不超过 7 天。',
  }),
}, { tags: ['公众号统计'] });
