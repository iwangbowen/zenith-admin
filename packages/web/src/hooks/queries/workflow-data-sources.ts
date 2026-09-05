import type { QueryOf } from '@zenith/shared/core';
import { workflowDataSourceContract } from '@zenith/shared/workflow';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowDataSourceListParams = QueryOf<typeof workflowDataSourceContract.list>;

export const {
  keys: workflowDataSourceKeys,
  useList: useWorkflowDataSourceList,
  useSave: useSaveWorkflowDataSource,
  useDelete: useDeleteWorkflowDataSources,
} = createResourceQueries(workflowDataSourceContract, {
  // 保留原有嵌套 key：运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播失效
  keyPrefix: ['workflow', 'data-sources'],
});

/** 连通性测试：直接拉一次选项，结果只在弹窗内展示，不进入缓存 */
export function useTestWorkflowDataSource() {
  return useApiMutation(workflowDataSourceContract.options, { requestOptions: { silent: true } });
}
