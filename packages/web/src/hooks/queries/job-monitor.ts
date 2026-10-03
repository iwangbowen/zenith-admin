import { JOB_SOURCE_KEYS, jobMonitorContract, type JobMonitorTrendRange, type JobSourceKey } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';
import type { QueryClient } from '@tanstack/react-query';

export type { JobMonitorTrendRange } from '@zenith/shared/platform';

export const jobMonitorKeys = {
  overview: contractKey(jobMonitorContract.overview),
  stuck: (key: JobSourceKey) => contractKey(jobMonitorContract.stuck, { params: { key } }),
  trend: (range: JobMonitorTrendRange) => contractKey(jobMonitorContract.trend, { query: { range } }),
};

export function invalidateJobMonitorAfterSourceChange(qc: QueryClient, key: JobSourceKey) {
  void qc.invalidateQueries({ queryKey: jobMonitorKeys.overview });
  void qc.invalidateQueries({ queryKey: jobMonitorKeys.stuck(key) });
}

export function useJobMonitorOverview({ refetchInterval = 30_000 }: {
  refetchInterval?: number | false;
} = {}) {
  return useApiQuery(jobMonitorContract.overview, undefined, { refetchInterval });
}

export function useJobMonitorTrend(range: JobMonitorTrendRange) {
  return useApiQuery(jobMonitorContract.trend, { query: { range } }, { refetchInterval: 60_000 });
}

export function useJobMonitorStuck(key: JobSourceKey | undefined, enabled: boolean) {
  return useApiQuery(jobMonitorContract.stuck, { params: { key: key ?? JOB_SOURCE_KEYS[0] }, query: { limit: 50 } }, {
    enabled: enabled && key !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
