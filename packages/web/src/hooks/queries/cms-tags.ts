import type { QueryOf } from '@zenith/shared/core';
import { cmsTagContract } from '@zenith/shared/cms';
import { contractKey, createResourceQueries, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CmsTagListParams = NonNullable<QueryOf<typeof cmsTagContract.list>>;

const resource = createResourceQueries(cmsTagContract);

export const cmsTagKeys = {
  ...resource.keys,
  /** 按站点分片的标签下拉源；工厂的 lookup 键是它们的公共前缀，增删改后随列表一起失效 */
  allTags: (siteId: number | undefined) => contractKey(cmsTagContract.all, { query: { siteId: siteId ?? 0 } }),
};

export const useCmsTagList = resource.useList;
export const useCmsTagDetail = resource.useDetail;
export const useSaveCmsTag = resource.useSave;
export const useDeleteCmsTags = resource.useDelete;

/** 站点全部标签（内容打标下拉），按站点分片缓存 */
export function useAllCmsTags(siteId: number | undefined) {
  return useApiQuery(cmsTagContract.all, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}