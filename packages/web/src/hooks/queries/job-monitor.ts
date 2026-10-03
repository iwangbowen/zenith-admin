import { JOB_SOURCE_KEYS, jobMonitorContract, type JobSourceKey } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const jobMonitorKeys = {
  overview: contractKey(jobMonitorContract.overview),
  stuck: (key: JobSourceKey) => contractKey(jobMonitorContract.stuck, { params: { key } }),
};

export function useJobMonitorOverview({ refetchInterval = 30_000 }: {
  refetchInterval?: number | false;
} = {}) {
  return useApiQuery(jobMonitorContract.overview, undefined, { refetchInterval });
}

export function useJobMonitorStuck(key: JobSourceKey | undefined, enabled: boolean) {
  return useApiQuery(jobMonitorContract.stuck, { params: { key: key ?? JOB_SOURCE_KEYS[0] }, query: { limit: 50 } }, {
    enabled: enabled && key !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
