import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowTriggerExecution, WorkflowTriggerExecutionStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowTriggerExecutionListParams {
  page: number;
  pageSize: number;
  status?: WorkflowTriggerExecutionStatus;
  instanceId?: number;
  nodeKey?: string;
}

export const workflowTriggerExecutionKeys = {
  all: ['workflow', 'trigger-executions'] as const,
  lists: ['workflow', 'trigger-executions', 'list'] as const,
  list: (params: WorkflowTriggerExecutionListParams) => ['workflow', 'trigger-executions', 'list', params] as const,
  detail: (id: number | null | undefined) => ['workflow', 'trigger-executions', 'detail', id ?? null] as const,
};

export function useWorkflowTriggerExecutionList(params: WorkflowTriggerExecutionListParams) {
  return useQuery({
    queryKey: workflowTriggerExecutionKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowTriggerExecution>>(`/api/workflows/trigger-executions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowTriggerExecutionDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowTriggerExecutionKeys.detail(id),
    queryFn: () => request.get<WorkflowTriggerExecution>(`/api/workflows/trigger-executions/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}
