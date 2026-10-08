import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { CHANNEL_ANALYSIS_DIMENSIONS, SHORT_LINK_STATS_MAX_DAYS } from '../constants';
import { shortLinkTrendPointSchema } from './short-links';

// ─── 聚合结果 ────────────────────────────────────────────────────────────────

export const channelAnalysisRowSchema = z.object({
  name: z.string().meta({ description: '维度值（utm_source / utm_medium / utm_campaign），未设置归为「未设置」' }),
  clicks: z.int().meta({ description: '短链点击（PV）' }),
  uv: z.int().meta({ description: '独立访客' }),
  conversions: z.int().nullable().meta({ description: '转化事件数（选择了转化事件时返回）' }),
  convRate: z.number().nullable().meta({ description: '转化率（conversions / clicks，保留 4 位小数；clicks=0 时为 null）' }),
}).meta({ id: 'ChannelAnalysisRow' });

export type ChannelAnalysisRow = z.infer<typeof channelAnalysisRowSchema>;

export const channelAnalysisResultSchema = z.object({
  totals: z.object({
    clicks: z.int(),
    uv: z.int(),
    links: z.int().meta({ description: '窗口内产生过点击的短链数' }),
    conversions: z.int().nullable(),
  }),
  trend: z.array(shortLinkTrendPointSchema),
  rows: z.array(channelAnalysisRowSchema),
}).meta({ id: 'ChannelAnalysis' });

export type ChannelAnalysisResult = z.infer<typeof channelAnalysisResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const channelAnalysisQuery = z.object({
  dimension: z.enum(CHANNEL_ANALYSIS_DIMENSIONS).default('source'),
  days: z.coerce.number().int().min(1).max(SHORT_LINK_STATS_MAX_DAYS).optional().meta({ description: '统计窗口天数，默认 30' }),
  convEvent: z.string().max(128).optional().meta({ description: '转化事件名（事件字典），传入后返回各渠道转化数与转化率' }),
});

export const channelAnalysisContract = defineContract('/api/growth/channel-analysis', {
  analyze: op.get('/', { access: { permission: 'shortlink:analysis:view' }, query: channelAnalysisQuery, response: channelAnalysisResultSchema, summary: '按 UTM 维度聚合短链点击与转化' }),
}, { tags: ['渠道推广分析'], feature: 'growth' });
