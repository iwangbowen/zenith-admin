import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsFriendLinkContract, type CmsFriendLinkGroup } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, createResourceQueries } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CmsFriendLinkListParams = NonNullable<QueryOf<typeof cmsFriendLinkContract.list>>;

export type CmsFriendLinkGroupListParams = NonNullable<QueryOf<typeof cmsFriendLinkContract.groupList>>;

const resource = createResourceQueries(cmsFriendLinkContract);

export const cmsFriendLinkKeys = {
  ...resource.keys,
  groups: contractKey(cmsFriendLinkContract.groupList),
  groupList: (params: CmsFriendLinkGroupListParams) => contractKey(cmsFriendLinkContract.groupList, { query: params }),
  groupAll: (siteId: number | undefined) => contractKey(cmsFriendLinkContract.groupAll, { query: { siteId: siteId ?? 0 } }),
};

export const useCmsFriendLinkList = resource.useList;
/** 友链本身的增删改不改变分组集合：工厂只失效列表与详情 */
export const useSaveCmsFriendLink = resource.useSave;
export const useDeleteCmsFriendLinks = resource.useDelete;

export function useCmsFriendLinkGroupList(params: CmsFriendLinkGroupListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsFriendLinkContract.groupList, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 站点全部启用分组（友链表单下拉 / 列表筛选） */
export function useAllCmsFriendLinkGroups(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsFriendLinkContract.groupAll, { query: { siteId: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 分组改名 / 删除会改变友链列表里的分组名与归属，整域失效 */
export function useSaveCmsFriendLinkGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<BodyOf<typeof cmsFriendLinkContract.groupCreate>> }): Promise<CmsFriendLinkGroup> =>
      id === undefined
        ? api(cmsFriendLinkContract.groupCreate, { body: values as BodyOf<typeof cmsFriendLinkContract.groupCreate> })
        : api(cmsFriendLinkContract.groupUpdate, { params: { id }, body: values }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.all }),
  });
}

export function useDeleteCmsFriendLinkGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(cmsFriendLinkContract.groupRemove, { params: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.all }),
  });
}
