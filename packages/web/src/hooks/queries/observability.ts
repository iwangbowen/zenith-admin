import { observabilityContract } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const observabilityKeys = {
  summary: contractKey(observabilityContract.summary),
};

export function useObservabilitySummary(refetchInterval: number | false = 15_000, enabled = true) {
  return useApiQuery(observabilityContract.summary, undefined, {
    enabled,
    refetchInterval,
    requestOptions: { silent: true },
  });
}
