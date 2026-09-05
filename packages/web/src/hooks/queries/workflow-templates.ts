import { useQuery } from '@tanstack/react-query';
import { workflowTemplateContract } from '@zenith/shared/workflow';
import { api, useApiMutation } from '@/lib/contract-query';

export const workflowTemplateKeys = {
  all: ['workflow', 'templates'] as const,
  lists: ['workflow', 'templates', 'list'] as const,
  list: () => ['workflow', 'templates', 'list'] as const,
};

export function useWorkflowTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowTemplateKeys.list(),
    queryFn: () => api(workflowTemplateContract.list),
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateWorkflowTemplate() {
  return useApiMutation(workflowTemplateContract.update, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowTemplateKeys.all }),
  });
}

export function useDeleteWorkflowTemplate() {
  return useApiMutation(workflowTemplateContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: workflowTemplateKeys.all }),
  });
}

/** 从模板创建流程定义会新增定义，广播整个 workflow 子树 */
export function useCloneWorkflowTemplate() {
  return useApiMutation(workflowTemplateContract.clone, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}
