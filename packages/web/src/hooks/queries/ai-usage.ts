import { keepPreviousData } from '@tanstack/react-query';
import { aiUsageContract } from '@zenith/shared/ai';
import type { AiUsageByModel, AiUsageByUser, AiUsageOverview, AiUsageStats, AiUsageTrend } from '@zenith/shared/ai';
import type { QueryOf } from '@zenith/shared/core';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type AiUsageStatsParams = NonNullable<QueryOf<typeof aiUsageContract.stats>>;

export const aiUsageKeys = {
  statsRoot: contractKey(aiUsageContract.stats),
  stats: (params: AiUsageStatsParams) => contractKey(aiUsageContract.stats, { query: params }),
};

export function useAiUsageStats(params: AiUsageStatsParams) {
  return useApiQuery(aiUsageContract.stats, { query: params }, { placeholderData: keepPreviousData });
}

export type { AiUsageByModel, AiUsageByUser, AiUsageOverview, AiUsageStats, AiUsageTrend };
