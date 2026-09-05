import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workflowCategoryContract } from '@zenith/shared/workflow';
import { api, createResourceQueries } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

const resource = createResourceQueries(workflowCategoryContract, {
  // 分类下拉（useWorkflowCategories）与列表页共用 ['workflow','categories'] 前缀，保存 / 删除后一并失效
  keyPrefix: ['workflow', 'categories'],
});

export const workflowCategoryKeys = {
  ...resource.keys,
  /** 全部分类（发起工作台分组 / 定义页侧栏 / 待办筛选共用） */
  all: ['workflow', 'categories'] as const,
};

export const useSaveWorkflowCategory = resource.useSave;
export const useDeleteWorkflowCategories = resource.useDelete;

export function useWorkflowCategories() {
  const categoriesQuery = useQuery({
    queryKey: workflowCategoryKeys.all,
    queryFn: () => api(workflowCategoryContract.all),
    staleTime: LOOKUP_STALE_TIME,
  });
  const { data, isFetching, refetch: refetchCategories } = categoriesQuery;

  const refetch = useCallback(async () => {
    await refetchCategories();
  }, [refetchCategories]);

  return { categories: data ?? [], loading: isFetching, refetch };
}
