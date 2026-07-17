import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface AiUsageStatsParams {
  startDate: string;
  endDate: string;
}

export interface AiUsageOverview {
  totalConversations: number;
  totalMessages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  activeUsers: number;
  /** 预估成本（分），未配置单价的模型不计入 */
  totalCostFen: number;
  avgTtftMs: number | null;
  /** 请求成功率（0-100），无数据为 null */
  successRate: number | null;
}

export interface AiUsageByModel {
  model: string;
  provider: string | null;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  avgTtftMs: number | null;
  costFen: number | null;
}

export interface AiUsageByUser {
  userId: number;
  username: string;
  nickname: string;
  conversations: number;
  messages: number;
  totalTokens: number;
}

export interface AiUsageTrend {
  date: string;
  messages: number;
  totalTokens: number;
}

export interface AiUsageStats {
  overview: AiUsageOverview;
  byModel: AiUsageByModel[];
  byUser: AiUsageByUser[];
  trend: AiUsageTrend[];
}

export const aiUsageKeys = {
  all: ['ai-usage'] as const,
  statsRoot: ['ai-usage', 'stats'] as const,
  stats: (params: AiUsageStatsParams) => ['ai-usage', 'stats', params] as const,
};

export function useAiUsageStats(params: AiUsageStatsParams) {
  return useQuery({
    queryKey: aiUsageKeys.stats(params),
    queryFn: () => request.get<AiUsageStats>(`/api/ai/usage/stats${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}
