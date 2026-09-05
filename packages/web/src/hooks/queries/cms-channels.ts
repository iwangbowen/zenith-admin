import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf } from '@zenith/shared/core';
import { cmsChannelContract, type CmsChannel } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, useApiMutation } from '@/lib/contract-query';
import { cmsContentKeys } from './cms-contents';

/** 栏目没有分页列表，树即列表；任何写操作都改变树结构，按域根整体失效 */
export const cmsChannelKeys = {
  all: [resourceKeyOf(cmsChannelContract.basePath)] as const,
  tree: (siteId: number | undefined) => contractKey(cmsChannelContract.tree, { query: { siteId: siteId ?? 0 } }),
  detail: (id: number | undefined) => contractKey(cmsChannelContract.detail, { params: { id: id ?? 0 } }),
  users: (channelId: number | undefined) => contractKey(cmsChannelContract.users, { params: { id: channelId ?? 0 } }),
};

export type CmsChannelSaveValues = Partial<BodyOf<typeof cmsChannelContract.create>>;

export function useCmsChannelTree(siteId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsChannelContract.tree, { query: { siteId: siteId ?? 0 } }),
    enabled: siteId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCmsChannelDetail(id: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsChannelContract.detail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveCmsChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CmsChannelSaveValues }): Promise<CmsChannel> =>
      id === undefined
        ? api(cmsChannelContract.create, { body: values as BodyOf<typeof cmsChannelContract.create> })
        : api(cmsChannelContract.update, { params: { id }, body: values }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsChannelKeys.all }),
  });
}

export function useDeleteCmsChannel() {
  return useApiMutation(cmsChannelContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsChannelKeys.all }),
  });
}

/** 栏目运维：合并 / 清空会把内容搬走或移入回收站，内容列表一并失效 */
export function useMergeCmsChannels() {
  return useApiMutation(cmsChannelContract.merge, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsChannelKeys.all });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.all });
    },
  });
}

export function useClearCmsChannel() {
  return useApiMutation(cmsChannelContract.clear, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsChannelKeys.all });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.all });
    },
  });
}

export function useBatchCreateCmsChannels() {
  return useApiMutation(cmsChannelContract.batchCreate, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsChannelKeys.all }),
  });
}

// ─── 栏目授权用户（栏目级数据权限）─────────────────────────────────────────────
export function useCmsChannelUsers(channelId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsChannelContract.users, { params: { id: channelId ?? 0 } }),
    enabled: enabled && channelId !== undefined,
  });
}

/** 授权名单影响树节点的可管理标记，整域失效 */
export function useSetCmsChannelUsers() {
  return useApiMutation(cmsChannelContract.setUsers, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsChannelKeys.all }),
  });
}
