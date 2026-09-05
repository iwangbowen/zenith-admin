import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowTriggerExecutionContract } from '@zenith/shared/workflow';
import { api } from '@/lib/contract-query';

export type WorkflowTriggerExecutionListParams = QueryOf<typeof workflowTriggerExecutionContract.list>;

export const workflowTriggerExecutionKeys = {
  all: ['workflow', 'trigger-executions'] as const,
  lists: ['workflow', 'trigger-executions', 'list'] as const,
  list: (params: WorkflowTriggerExecutionListParams) => ['workflow', 'trigger-executions', 'list', params] as const,
  detail: (id: number | null | undefined) => ['workflow', 'trigger-executions', 'detail', id ?? null] as const,
};

export function useWorkflowTriggerExecutionList(params: WorkflowTriggerExecutionListParams) {
  return useQuery({
    queryKey: workflowTriggerExecutionKeys.list(params),
    queryFn: () => api(workflowTriggerExecutionContract.list, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowTriggerExecutionDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowTriggerExecutionKeys.detail(id),
    queryFn: () => api(workflowTriggerExecutionContract.detail, { params: { id: id as number } }),
    enabled: enabled && !!id,
  });
}
