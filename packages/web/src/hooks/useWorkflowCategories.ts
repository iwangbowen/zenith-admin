import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkflowCategory } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';

export const workflowCategoryKeys = {
  all: ['workflow', 'categories'] as const,
};

export function useWorkflowCategories() {
  const categoriesQuery = useQuery({
    queryKey: workflowCategoryKeys.all,
    queryFn: () => request.get<WorkflowCategory[]>('/api/workflows/categories/all').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
  const { data, isFetching, refetch: refetchCategories } = categoriesQuery;

  const refetch = useCallback(async () => {
    await refetchCategories();
  }, [refetchCategories]);

  return { categories: data ?? [], loading: isFetching, refetch };
}
