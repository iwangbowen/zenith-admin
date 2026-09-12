import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsAdContract } from '@zenith/shared/cms';
import { useSaveMutation, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type CmsAdListParams = NonNullable<QueryOf<typeof cmsAdContract.list>>;

export type CmsAdEventListParams = NonNullable<QueryOf<typeof cmsAdContract.events>>;

export type CmsAdEventStatsParams = NonNullable<QueryOf<typeof cmsAdContract.eventStats>>;

/** 全部站点广告位列表的公共前缀 */
const slotsKey = contractKey(cmsAdContract.slots);

/**
 * 广告位与广告互相引用：广告位列表带投放中广告数 adCount，广告列表 / 详情带 slotName。
 * 广告增删改由工厂失效列表与详情，这里补上广告位的计数列。
 */
const resource = createResourceQueries(cmsAdContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: slotsKey }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: slotsKey }),
});

export const cmsAdKeys = {
  ...resource.keys,
  slotsAll: slotsKey,
  slots: (siteId: number | undefined) => contractKey(cmsAdContract.slots, { query: { siteId: siteId ?? 0 } }),
};

export const cmsAdEventKeys = {
  lists: contractKey(cmsAdContract.events),
  list: (params: CmsAdEventListParams) => contractKey(cmsAdContract.events, { query: params }),
  statsAll: contractKey(cmsAdContract.eventStats),
  stats: (params: CmsAdEventStatsParams) => contractKey(cmsAdContract.eventStats, { query: params }),
};

export function useCmsAdSlots(siteId: number | undefined) {
  return useApiQuery(cmsAdContract.slots, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
  });
}

export type CmsAdSlotSaveValues = Partial<BodyOf<typeof cmsAdContract.slotCreate>>;

/**
 * 广告位改名 / 删除会改变广告列表里的 slotName（删除后广告失去归属），一并失效；
 * 广告没有详情查询，投放事件也不引用广告位。
 */
function invalidateAfterCmsAdSlotChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsAdKeys.slotsAll });
  void qc.invalidateQueries({ queryKey: cmsAdKeys.lists });
}

export function useSaveCmsAdSlot() {
  return useSaveMutation(cmsAdContract.slotCreate, cmsAdContract.slotUpdate, { invalidate: invalidateAfterCmsAdSlotChange });
}

export function useDeleteCmsAdSlot() {
  return useApiMutation(cmsAdContract.slotRemove, { invalidate: invalidateAfterCmsAdSlotChange });
}

export const useCmsAdList = resource.useList;
export const useSaveCmsAd = resource.useSave;
export const useDeleteCmsAds = resource.useDelete;

export function useCmsAdEventList(params: CmsAdEventListParams, enabled = true) {
  return useApiQuery(cmsAdContract.events, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsAdEventStats(params: CmsAdEventStatsParams, enabled = true) {
  return useApiQuery(cmsAdContract.eventStats, { query: params }, {
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