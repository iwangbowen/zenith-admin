import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsAdContract, type CmsAdSlot } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsAdListParams = NonNullable<QueryOf<typeof cmsAdContract.list>>;

export type CmsAdEventListParams = NonNullable<QueryOf<typeof cmsAdContract.events>>;

export type CmsAdEventStatsParams = NonNullable<QueryOf<typeof cmsAdContract.eventStats>>;

/** 广告位与广告互相引用（广告位列表带投放计数、广告列表带广告位名），写操作按域根失效 */
const resource = createResourceQueries(cmsAdContract);

export const cmsAdKeys = {
  ...resource.keys,
  slots: (siteId: number | undefined) => contractKey(cmsAdContract.slots, { query: { siteId: siteId ?? 0 } }),
};

export const cmsAdEventKeys = {
  lists: contractKey(cmsAdContract.events),
  list: (params: CmsAdEventListParams) => contractKey(cmsAdContract.events, { query: params }),
  statsAll: contractKey(cmsAdContract.eventStats),
  stats: (params: CmsAdEventStatsParams) => contractKey(cmsAdContract.eventStats, { query: params }),
};

export function useCmsAdSlots(siteId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsAdContract.slots, { query: { siteId: siteId ?? 0 } }),
    enabled: siteId !== undefined,
  });
}

export type CmsAdSlotSaveValues = Partial<BodyOf<typeof cmsAdContract.slotCreate>>;

export function useSaveCmsAdSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CmsAdSlotSaveValues }): Promise<CmsAdSlot> =>
      id === undefined
        ? api(cmsAdContract.slotCreate, { body: values as BodyOf<typeof cmsAdContract.slotCreate> })
        : api(cmsAdContract.slotUpdate, { params: { id }, body: values }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsAdKeys.all }),
  });
}

export function useDeleteCmsAdSlot() {
  return useApiMutation(cmsAdContract.slotRemove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsAdKeys.all }),
  });
}

export const useCmsAdList = resource.useList;
export const useSaveCmsAd = resource.useSave;
export const useDeleteCmsAds = resource.useDelete;

export function useCmsAdEventList(params: CmsAdEventListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsAdContract.events, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsAdEventStats(params: CmsAdEventStatsParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsAdContract.eventStats, { query: params }),
    enabled,
  });
}

export function useCleanupCmsAdEvents() {
  return useApiMutation(cmsAdContract.cleanupEvents, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsAdEventKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsAdEventKeys.statsAll });
    },
  });
}
