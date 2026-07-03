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
}

export interface AiUsageByModel {
  model: string;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
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
