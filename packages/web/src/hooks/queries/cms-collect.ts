import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsCollectContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsCollectRuleListParams = NonNullable<QueryOf<typeof cmsCollectContract.list>>;

export type CmsCollectItemListParams = NonNullable<QueryOf<typeof cmsCollectContract.items>>;

const resource = createResourceQueries(cmsCollectContract);

export const cmsCollectKeys = {
  ...resource.keys,
  items: (ruleId: number, params: CmsCollectItemListParams) => contractKey(cmsCollectContract.items, { params: { id: ruleId }, query: params }),
};

export function useCmsCollectRules(params: Omit<CmsCollectRuleListParams, 'siteId'> & { siteId: number | undefined }) {
  return useQuery({
    ...apiQueryOptions(cmsCollectContract.list, { query: { ...params, siteId: params.siteId ?? 0 } }),
    enabled: !!params.siteId,
    placeholderData: keepPreviousData,
  });
}

export const useSaveCmsCollectRule = resource.useSave;
export const useDeleteCmsCollectRules = resource.useDelete;

/** 执行采集会更新规则的 lastRunAt 并产生采集明细 */
export function useRunCmsCollectRule() {
  return useApiMutation(cmsCollectContract.run, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsCollectKeys.all }),
  });
}

export function useCmsCollectItems(ruleId: number | undefined, params: CmsCollectItemListParams) {
  return useQuery({
    ...apiQueryOptions(cmsCollectContract.items, { params: { id: ruleId ?? 0 }, query: params }),
    enabled: !!ruleId,
    placeholderData: keepPreviousData,
  });
}
