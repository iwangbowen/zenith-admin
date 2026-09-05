import { useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowAutomationContract } from '@zenith/shared/workflow';
import { api, createResourceQueries } from '@/lib/contract-query';

export type WorkflowAutomationListParams = QueryOf<typeof workflowAutomationContract.list>;

export type WorkflowAutomationRunListParams = QueryOf<typeof workflowAutomationContract.runs>;

export const {
  keys: workflowAutomationKeys,
  useList: useWorkflowAutomationList,
  useDetail: useWorkflowAutomationDetail,
  useSave: useSaveWorkflowAutomation,
  useDelete: useDeleteWorkflowAutomations,
} = createResourceQueries(workflowAutomationContract, {
  // 保留原有嵌套 key：多处运行时流程用 invalidateQueries({ queryKey: ['workflow'] }) 广播，
  // 改成扁平前缀会让本域悄悄脱离该失效范围
  keyPrefix: ['workflow', 'automations'],
});

/** 自动化动作执行记录（打开执行记录抽屉时启用） */
export function useWorkflowAutomationRunList(params: WorkflowAutomationRunListParams, enabled = true) {
  return useQuery({
    queryKey: [...workflowAutomationKeys.all, 'runs', params] as const,
    queryFn: () => api(workflowAutomationContract.runs, { query: params }),
    enabled,
  });
}
