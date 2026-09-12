import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsFriendLinkContract } from '@zenith/shared/cms';
import { useSaveMutation, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CmsFriendLinkListParams = NonNullable<QueryOf<typeof cmsFriendLinkContract.list>>;

export type CmsFriendLinkGroupListParams = NonNullable<QueryOf<typeof cmsFriendLinkContract.groupList>>;

/** 全部分组分页列表的公共前缀 */
const groupListsKey = contractKey(cmsFriendLinkContract.groupList);

/** 友链增删改由工厂失效列表与详情；分组分页列表带组内友链数 linkCount，这里补上它。分组下拉源不含计数，不动 */
const resource = createResourceQueries(cmsFriendLinkContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: groupListsKey }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: groupListsKey }),
});

export const cmsFriendLinkKeys = {
  ...resource.keys,
  groups: groupListsKey,
  groupList: (params: CmsFriendLinkGroupListParams) => contractKey(cmsFriendLinkContract.groupList, { query: params }),
  /** 全部站点分组下拉源的公共前缀 */
  groupAlls: contractKey(cmsFriendLinkContract.groupAll),
  groupAll: (siteId: number | undefined) => contractKey(cmsFriendLinkContract.groupAll, { query: { siteId: siteId ?? 0 } }),
};

/**
 * 分组增删改后的失效面：分组分页列表、分组下拉源（LOOKUP_STALE_TIME，改名 / 新增 / 删除都要刷新），
 * 以及友链列表——列表项带 groupName，分组改名或删除（组内友链转为未分组）后必须回源。友链详情缓存不含分组名，不动。
 */
export function invalidateAfterCmsFriendLinkGroupChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.groups });
  void qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.groupAlls });
  void qc.invalidateQueries({ queryKey: cmsFriendLinkKeys.lists });
}

export const useCmsFriendLinkList = resource.useList;
export const useSaveCmsFriendLink = resource.useSave;
export const useDeleteCmsFriendLinks = resource.useDelete;

export function useCmsFriendLinkGroupList(params: CmsFriendLinkGroupListParams, enabled = true) {
  return useApiQuery(cmsFriendLinkContract.groupList, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 站点全部启用分组（友链表单下拉 / 列表筛选） */
export function useAllCmsFriendLinkGroups(siteId: number | undefined, enabled = true) {
  return useApiQuery(cmsFriendLinkContract.groupAll, { query: { siteId: siteId ?? 0 } }, {
    enabled: enabled && siteId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveCmsFriendLinkGroup() {
  return useSaveMutation(cmsFriendLinkContract.groupCreate, cmsFriendLinkContract.groupUpdate, {
    invalidate: invalidateAfterCmsFriendLinkGroupChange,
  });
}

export function useDeleteCmsFriendLinkGroup() {
  return useApiMutation(cmsFriendLinkContract.groupRemove, { invalidate: invalidateAfterCmsFriendLinkGroupChange });
}