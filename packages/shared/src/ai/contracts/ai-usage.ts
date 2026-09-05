import * as z from 'zod';
import { dateRangeBound } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const aiUsageOverviewSchema = z.object({
  totalConversations: z.int().meta({ description: '对话总数' }),
  totalMessages: z.int().meta({ description: 'AI 回复消息数' }),
  tokensInput: z.int().meta({ description: '输入 token 总数' }),
  tokensOutput: z.int().meta({ description: '输出 token 总数' }),
  totalTokens: z.int().meta({ description: 'token 总数' }),
  activeUsers: z.int().meta({ description: '活跃用户数' }),
  totalCostFen: z.number().meta({ description: '预估成本（分），未配置单价的模型不计入' }),
  avgTtftMs: z.number().nullable().meta({ description: '平均首字延迟（毫秒）' }),
  successRate: z.number().nullable().meta({ description: '请求成功率（0-100，无数据为 null）' }),
}).meta({ id: 'AiUsageOverview' });

export type AiUsageOverview = z.infer<typeof aiUsageOverviewSchema>;

export const aiUsageByModelSchema = z.object({
  model: z.string(),
  provider: z.string().nullable(),
  messages: z.int(),
  tokensInput: z.int(),
  tokensOutput: z.int(),
  totalTokens: z.int(),
  avgTtftMs: z.number().nullable(),
  costFen: z.number().nullable(),
}).meta({ id: 'AiUsageByModel' });

export type AiUsageByModel = z.infer<typeof aiUsageByModelSchema>;

export const aiUsageByUserSchema = z.object({
  userId: z.int(),
  username: z.string(),
  nickname: z.string(),
  conversations: z.int(),
  messages: z.int(),
  totalTokens: z.int(),
}).meta({ id: 'AiUsageByUser' });

export type AiUsageByUser = z.infer<typeof aiUsageByUserSchema>;

export const aiUsageTrendSchema = z.object({
  date: z.string(),
  messages: z.int(),
  totalTokens: z.int(),
}).meta({ id: 'AiUsageTrend' });

export type AiUsageTrend = z.infer<typeof aiUsageTrendSchema>;

/** 用量仪表盘一次性聚合（概览 + 按模型 + 按用户 Top10 + 按日趋势） */
export const aiUsageStatsSchema = z.object({
  overview: aiUsageOverviewSchema,
  byModel: z.array(aiUsageByModelSchema).meta({ description: '按模型聚合' }),
  byUser: z.array(aiUsageByUserSchema).meta({ description: '按用户聚合（Top 10）' }),
  trend: z.array(aiUsageTrendSchema).meta({ description: '按日趋势' }),
}).meta({ id: 'AiUsageStats' });

export type AiUsageStats = z.infer<typeof aiUsageStatsSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const aiUsageStatsQuery = z.object({
  startDate: dateRangeBound('起始日期 YYYY-MM-DD'),
  endDate: dateRangeBound('结束日期 YYYY-MM-DD'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiUsageContract = defineContract('/api/ai/usage', {
  stats: op.get('/stats', { query: aiUsageStatsQuery, response: aiUsageStatsSchema, summary: '获取 AI 用量统计' }),
}, { tags: ['AI'] });
