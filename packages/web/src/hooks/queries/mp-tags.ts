import type { QueryOf } from '@zenith/shared/core';
import { mpTagContract } from '@zenith/shared/mp';
import { createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MpTagListParams = QueryOf<typeof mpTagContract.list>;

export const {
  keys: mpTagKeys,
  useList: useMpTagList,
  useSave: useSaveMpTag,
  useDelete: useDeleteMpTags,
} = createResourceQueries(mpTagContract);

/** 标签下拉源（粉丝筛选 / 打标签）：取该公众号前 200 条；key 落在 lists 前缀下，随增删改与同步一并失效 */
export function useMpTagOptions(accountId: number | null | undefined) {
  return useApiQuery(
    mpTagContract.list,
    { query: { accountId: accountId ?? 0, page: 1, pageSize: 200 } },
    { enabled: !!accountId },
  );
}

/** 同步只重建标签清单（名称 / 微信 ID / 粉丝数） */
export function useSyncMpTags() {
  return useApiMutation(mpTagContract.sync, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpTagKeys.lists }),
  });
}
