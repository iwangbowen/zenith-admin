import { workflowTemplateContract } from '@zenith/shared/workflow';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { workflowDefinitionKeys } from './workflow-definitions';

export const workflowTemplateKeys = {
  lists: contractKey(workflowTemplateContract.list),
  list: () => contractKey(workflowTemplateContract.list),
};

export function useWorkflowTemplates(options?: { enabled?: boolean }) {
  return useApiQuery(workflowTemplateContract.list, { enabled: options?.enabled ?? true });
}

export function useUpdateWorkflowTemplate() {
  return useApiMutation(workflowTemplateContract.update, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowTemplateKeys.lists }),
  });
}

export function useDeleteWorkflowTemplate() {
  return useApiMutation(workflowTemplateContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowTemplateKeys.lists }),
  });
}

/** 从模板创建流程定义：模板本身不变，只在定义列表多出一条草稿（未发布，不影响已发布下拉） */
export function useCloneWorkflowTemplate() {
  return useApiMutation(workflowTemplateContract.clone, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowDefinitionKeys.lists }),
  });
}
