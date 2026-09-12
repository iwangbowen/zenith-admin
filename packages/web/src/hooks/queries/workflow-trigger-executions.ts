import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { workflowTriggerExecutionContract } from '@zenith/shared/workflow';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type WorkflowTriggerExecutionListParams = QueryOf<typeof workflowTriggerExecutionContract.list>;

export const workflowTriggerExecutionKeys = {
  lists: contractKey(workflowTriggerExecutionContract.list),
  list: (params: WorkflowTriggerExecutionListParams) => contractKey(workflowTriggerExecutionContract.list, { query: params }),
  detail: (id: number) => contractKey(workflowTriggerExecutionContract.detail, { params: { id } }),
};

export function useWorkflowTriggerExecutionList(params: WorkflowTriggerExecutionListParams) {
  return useApiQuery(workflowTriggerExecutionContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useWorkflowTriggerExecutionDetail(id: number | null | undefined, enabled = true) {
  return useApiQuery(workflowTriggerExecutionContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}
