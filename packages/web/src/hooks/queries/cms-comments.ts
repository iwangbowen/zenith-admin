import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsCommentContract } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey } from '@/lib/contract-query';

export type CmsCommentListParams = NonNullable<QueryOf<typeof cmsCommentContract.list>>;

export const cmsCommentKeys = {
  lists: contractKey(cmsCommentContract.list),
  list: (params: CmsCommentListParams) => contractKey(cmsCommentContract.list, { query: params }),
  pendingCount: (siteId: number | undefined) => contractKey(cmsCommentContract.pendingCount, { query: { siteId: siteId ?? 0 } }),
};

export function useCmsCommentList(params: CmsCommentListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsCommentContract.list, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type CmsCommentAction = 'approve' | 'reject' | 'delete';

const COMMENT_ACTIONS = {
  approve: cmsCommentContract.approve,
  reject: cmsCommentContract.reject,
  delete: cmsCommentContract.batchDelete,
} as const;

/** 审核 / 拒绝 / 删除都改变列表与待审计数 */
export function useCmsCommentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: CmsCommentAction; ids: number[] }) => api(COMMENT_ACTIONS[action], { body: { ids } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsCommentKeys.lists });
      void qc.invalidateQueries({ queryKey: contractKey(cmsCommentContract.pendingCount) });
    },
  });
}
