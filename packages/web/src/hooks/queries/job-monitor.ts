import { jobMonitorContract } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const jobMonitorKeys = {
  overview: contractKey(jobMonitorContract.overview),
};

export function useJobMonitorOverview({ refetchInterval = 30_000 }: {
  refetchInterval?: number | false;
} = {}) {
  return useApiQuery(jobMonitorContract.overview, undefined, { refetchInterval });
}
