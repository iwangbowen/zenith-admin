import { useQuery } from '@tanstack/react-query';
import { cmsDashboardContract, cmsStatContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey } from '@/lib/contract-query';

export const cmsStatKeys = {
  visits: (siteId: number | undefined, days: number) => contractKey(cmsStatContract.visits, { query: { siteId: siteId ?? 0, days } }),
  search: (siteId: number | undefined, days: number) => contractKey(cmsStatContract.search, { query: { siteId: siteId ?? 0, days } }),
};

export const cmsDashboardKeys = {
  stats: (siteId: number | undefined) => contractKey(cmsDashboardContract.stats, { query: { siteId: siteId ?? 0 } }),
};

export function useCmsVisitStats(siteId: number | undefined, days: number) {
  return useQuery({
    ...apiQueryOptions(cmsStatContract.visits, { query: { siteId: siteId ?? 0, days } }),
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}

export function useCmsSearchAnalytics(siteId: number | undefined, days: number) {
  return useQuery({
    ...apiQueryOptions(cmsStatContract.search, { query: { siteId: siteId ?? 0, days } }),
    enabled: siteId !== undefined,
  });
}

export function useCmsDashboardStats(siteId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsDashboardContract.stats, { query: { siteId: siteId ?? 0 } }),
    enabled: siteId !== undefined,
    refetchInterval: 60_000,
  });
}
