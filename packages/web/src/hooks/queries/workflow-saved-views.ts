import { workflowSavedViewContract } from '@zenith/shared/workflow';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const workflowSavedViewKeys = {
  /** 全部列表页保存视图的公共前缀 */
  lists: contractKey(workflowSavedViewContract.list),
  list: (pageKey: string) => contractKey(workflowSavedViewContract.list, { query: { pageKey } }),
};

/** 某列表页的保存视图（按 pageKey 归档） */
export function useWorkflowSavedViews(pageKey: string) {
  return useApiQuery(workflowSavedViewContract.list, { query: { pageKey } }, { staleTime: 30_000 });
}

export function useCreateWorkflowSavedView() {
  return useApiMutation(workflowSavedViewContract.create, {
    // 新视图只出现在所属列表页的视图条
    invalidate: (qc, _saved, { body }) => void qc.invalidateQueries({ queryKey: workflowSavedViewKeys.list(body.pageKey) }),
  });
}

export function useDeleteWorkflowSavedView() {
  return useApiMutation(workflowSavedViewContract.remove, {
    // 只有 id，不知所属页面：各页面的视图条一并回源（同屏最多挂载一个）
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowSavedViewKeys.lists }),
  });
}
