import type { QueryOf } from '@zenith/shared/core';
import { mpAutoReplyContract, mpMaterialContract } from '@zenith/shared/mp';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MpAutoReplyListParams = QueryOf<typeof mpAutoReplyContract.list>;

export const {
  keys: mpAutoReplyKeys,
  useList: useMpAutoReplyList,
  useSave: useSaveMpAutoReply,
  useDelete: useDeleteMpAutoReplies,
} = createResourceQueries(mpAutoReplyContract);

/** 未命中热词列表查询的公共前缀 */
const unmatchedKeys = contractKey(mpAutoReplyContract.unmatched);

/** 回复可选的素材（素材域的列表查询，随素材增删改一并失效） */
export function useMpAutoReplyMaterials(accountId: number | null | undefined) {
  return useApiQuery(
    mpMaterialContract.list,
    { query: { accountId: accountId ?? 0, page: 1, pageSize: 200 } },
    { enabled: !!accountId },
  );
}

export function useMpUnmatchedKeywords(accountId: number | null | undefined, enabled: boolean) {
  return useApiQuery(
    mpAutoReplyContract.unmatched,
    { query: { accountId: accountId ?? 0, page: 1, pageSize: 50 } },
    { enabled: enabled && !!accountId },
  );
}

/** 热词只出现在未命中列表，自动回复列表不受影响 */
export function useDeleteMpUnmatchedKeyword() {
  return useApiMutation(mpAutoReplyContract.removeUnmatched, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: unmatchedKeys }),
  });
}
