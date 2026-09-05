import { opsOverviewContract } from '@zenith/shared/ops';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const opsOverviewKeys = {
  all: contractKey(opsOverviewContract.get),
};

export function useOpsOverview() {
  // 概览是运行态快照，页面停留期间保持轮询
  return useApiQuery(opsOverviewContract.get, { refetchInterval: 30_000 });
}
