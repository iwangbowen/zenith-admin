import { useQuery } from '@tanstack/react-query';
import type { MpDatacube, MpStats } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpDatacubeParams {
  beginDate: string;
  endDate: string;
}

export const mpStatsKeys = {
  all: ['mp', 'stats'] as const,
  overview: (accountId: number | null | undefined) => ['mp', 'stats', accountId] as const,
  datacube: (accountId: number | null | undefined, params: MpDatacubeParams) => ['mp', 'stats', accountId, 'datacube', params] as const,
};

export function useMpStats(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpStatsKeys.overview(accountId),
    queryFn: () => request.get<MpStats>(`/api/mp/stats${toQueryString({ accountId })}`).then(unwrap),
    enabled: !!accountId,
  });
}

export function useMpDatacube(accountId: number | null | undefined, params: MpDatacubeParams, enabled = true) {
  return useQuery({
    queryKey: mpStatsKeys.datacube(accountId, params),
    queryFn: () => request.get<MpDatacube>(`/api/mp/stats/datacube${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: enabled && !!accountId,
  });
}
