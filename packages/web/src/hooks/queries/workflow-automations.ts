import type { QueryOf } from '@zenith/shared/core';
import { workflowAutomationContract } from '@zenith/shared/workflow';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type WorkflowAutomationListParams = QueryOf<typeof workflowAutomationContract.list>;

export type WorkflowAutomationRunListParams = QueryOf<typeof workflowAutomationContract.runs>;

const resource = createResourceQueries(workflowAutomationContract, {
  // 冻结动作记录保留，删除规则后刷新打开中的规则记录抽屉。
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: workflowAutomationKeys.runs }),
});

export const workflowAutomationKeys = {
  ...resource.keys,
  /** 全部执行记录查询（各筛选条件）的公共前缀 */
  runs: contractKey(workflowAutomationContract.runs),
  runList: (params: WorkflowAutomationRunListParams) => contractKey(workflowAutomationContract.runs, { query: params }),
};

export const useWorkflowAutomationList = resource.useList;
export const useWorkflowAutomationDetail = resource.useDetail;
export const useSaveWorkflowAutomation = resource.useSave;
export const useDeleteWorkflowAutomations = resource.useDelete;

/** 自动化动作执行记录（打开执行记录抽屉时启用） */
export function useWorkflowAutomationRunList(params: WorkflowAutomationRunListParams, enabled = true) {
  return useApiQuery(workflowAutomationContract.runs, { query: params }, { enabled, refetchInterval: enabled ? 3000 : false });
}

export const useRetryWorkflowAutomationRun = () => useApiMutation(workflowAutomationContract.retryRun, {
  invalidate: (qc) => qc.invalidateQueries({ queryKey: workflowAutomationKeys.runs }),
});
