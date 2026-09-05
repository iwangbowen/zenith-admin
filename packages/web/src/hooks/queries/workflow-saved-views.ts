import { useQuery, type QueryClient } from '@tanstack/react-query';
import { workflowSavedViewContract } from '@zenith/shared/workflow';
import { api, useApiMutation } from '@/lib/contract-query';

export const workflowSavedViewKeys = {
  all: ['workflow', 'saved-views'] as const,
  list: (pageKey: string) => ['workflow', 'saved-views', pageKey] as const,
};

const invalidateSavedViews = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowSavedViewKeys.all });
};

/** 某列表页的保存视图（按 pageKey 归档） */
export function useWorkflowSavedViews(pageKey: string) {
  return useQuery({
    queryKey: workflowSavedViewKeys.list(pageKey),
    queryFn: () => api(workflowSavedViewContract.list, { query: { pageKey } }),
    staleTime: 30_000,
  });
}

export function useCreateWorkflowSavedView() {
  return useApiMutation(workflowSavedViewContract.create, { invalidate: invalidateSavedViews });
}

export function useDeleteWorkflowSavedView() {
  return useApiMutation(workflowSavedViewContract.remove, { invalidate: invalidateSavedViews });
}
