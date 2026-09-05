import type { QueryOf } from '@zenith/shared/core';
import { mpStatsContract } from '@zenith/shared/mp';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type MpDatacubeParams = Omit<QueryOf<typeof mpStatsContract.datacube>, 'accountId'>;

export const mpStatsKeys = {
  datacube: (accountId: number | null | undefined, params: MpDatacubeParams) =>
    contractKey(mpStatsContract.datacube, { query: { accountId: accountId ?? 0, ...params } }),
};

export function useMpStats(accountId: number | null | undefined) {
  return useApiQuery(mpStatsContract.overview, { query: { accountId: accountId ?? 0 } }, { enabled: !!accountId });
}

export function useMpDatacube(accountId: number | null | undefined, params: MpDatacubeParams, enabled = true) {
  return useApiQuery(
    mpStatsContract.datacube,
    { query: { accountId: accountId ?? 0, ...params } },
    { enabled: enabled && !!accountId },
  );
}
