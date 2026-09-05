import { useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsTagContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey, createResourceQueries } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CmsTagListParams = NonNullable<QueryOf<typeof cmsTagContract.list>>;

const resource = createResourceQueries(cmsTagContract);

export const cmsTagKeys = {
  ...resource.keys,
  allTags: (siteId: number | undefined) => contractKey(cmsTagContract.all, { query: { siteId: siteId ?? 0 } }),
};

export const useCmsTagList = resource.useList;
export const useCmsTagDetail = resource.useDetail;
export const useSaveCmsTag = resource.useSave;
export const useDeleteCmsTags = resource.useDelete;

/** 站点全部标签（内容打标下拉），按站点分片缓存 */
export function useAllCmsTags(siteId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsTagContract.all, { query: { siteId: siteId ?? 0 } }),
    enabled: siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}
