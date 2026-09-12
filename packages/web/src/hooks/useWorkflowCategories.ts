import { useCallback } from 'react';
import { workflowCategoryContract } from '@zenith/shared/workflow';
import { createResourceQueries } from '@/lib/contract-query';

const resource = createResourceQueries(workflowCategoryContract);

/** 列表页与分类下拉（发起工作台分组 / 定义页侧栏 / 待办筛选）共用工厂 keys：保存 / 删除后下拉源随 lookup 一并失效 */
export const workflowCategoryKeys = resource.keys;

export const useSaveWorkflowCategory = resource.useSave;
export const useDeleteWorkflowCategories = resource.useDelete;

export function useWorkflowCategories() {
  const categoriesQuery = resource.useLookup();
  const { data, isFetching, refetch: refetchCategories } = categoriesQuery;

  const refetch = useCallback(async () => {
    await refetchCategories();
  }, [refetchCategories]);

  return { categories: data ?? [], loading: isFetching, refetch };
}
