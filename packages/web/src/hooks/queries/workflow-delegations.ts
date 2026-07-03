import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowDelegation } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowDelegationListParams {
  page: number;
  pageSize: number;
  scope: 'mine' | 'all';
}

export const workflowDelegationKeys = {
  all: ['workflow', 'delegations'] as const,
  lists: ['workflow', 'delegations', 'list'] as const,
  list: (params: WorkflowDelegationListParams) => ['workflow', 'delegations', 'list', params] as const,
};

export function useWorkflowDelegationList(params: WorkflowDelegationListParams) {
  return useQuery({
    queryKey: workflowDelegationKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowDelegation>>(`/api/workflows/delegations${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveWorkflowDelegation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<WorkflowDelegation>(`/api/workflows/delegations/${id}`, values) : request.post<WorkflowDelegation>('/api/workflows/delegations', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowDelegationKeys.all }),
  });
}

export function useDeleteWorkflowDelegation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/delegations/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowDelegationKeys.all }),
  });
}
