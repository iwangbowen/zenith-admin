// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsCommentContract } from '@zenith/shared/cms';
import { api, contractKey, useApiQuery } from '@/lib/contract-query';
import { invalidateCmsDashboardStats } from './cms-stats';

export type CmsCommentListParams = NonNullable<QueryOf<typeof cmsCommentContract.list>>;

export const cmsCommentKeys = {
  lists: contractKey(cmsCommentContract.list),
  list: (params: CmsCommentListParams) => contractKey(cmsCommentContract.list, { query: params }),
  /** 全部站点待审计数的公共前缀 */
  pendingCounts: contractKey(cmsCommentContract.pendingCount),
  pendingCount: (siteId: number | undefined) => contractKey(cmsCommentContract.pendingCount, { query: { siteId: siteId ?? 0 } }),
};

/** 审核 / 拒绝 / 删除都改变评论列表、待审计数徽标与看板的 pendingComments */
export function invalidateAfterCmsCommentChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsCommentKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsCommentKeys.pendingCounts });
  invalidateCmsDashboardStats(qc);
}

export function useCmsCommentList(params: CmsCommentListParams, enabled = true) {
  return useApiQuery(cmsCommentContract.list, { query: params }, {
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

/**
 * 审核 / 拒绝 / 删除（批量）。
 * H5：mutationFn 按 action 在三个契约操作间分派，不是单一契约操作，故保留手写 useMutation。
 */
export function useCmsCommentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: CmsCommentAction; ids: number[] }) => api(COMMENT_ACTIONS[action], { body: { ids } }),
    onSuccess: () => invalidateAfterCmsCommentChange(qc),
  });
}
