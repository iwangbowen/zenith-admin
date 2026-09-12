import type { QueryClient } from '@tanstack/react-query';
import { cmsDashboardContract, cmsStatContract } from '@zenith/shared/cms';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const cmsStatKeys = {
  visits: (siteId: number | undefined, days: number) => contractKey(cmsStatContract.visits, { query: { siteId: siteId ?? 0, days } }),
  search: (siteId: number | undefined, days: number) => contractKey(cmsStatContract.search, { query: { siteId: siteId ?? 0, days } }),
};

export const cmsDashboardKeys = {
  /** 全部站点看板统计的公共前缀（内容 / 栏目 / 评论写操作后按此失效） */
  statsAll: contractKey(cmsDashboardContract.stats),
  stats: (siteId: number | undefined) => contractKey(cmsDashboardContract.stats, { query: { siteId: siteId ?? 0 } }),
};

/**
 * 看板统计由内容表、栏目表与评论表聚合而来（totals / todayPublished / publishTrend /
 * channelDistribution / pendingComments）：内容状态与归属、栏目名称、评论审核任一变化都会改变它。
 * 访问统计（visits / search）来自访问日志与搜索日志，后台写操作不影响，不在此失效。
 */
export function invalidateCmsDashboardStats(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsDashboardKeys.statsAll });
}

export function useCmsVisitStats(siteId: number | undefined, days: number) {
  return useApiQuery(cmsStatContract.visits, { query: { siteId: siteId ?? 0, days } }, {
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}

export function useCmsSearchAnalytics(siteId: number | undefined, days: number) {
  return useApiQuery(cmsStatContract.search, { query: { siteId: siteId ?? 0, days } }, {
    enabled: siteId !== undefined,
  });
}

export function useCmsDashboardStats(siteId: number | undefined) {
  return useApiQuery(cmsDashboardContract.stats, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}
