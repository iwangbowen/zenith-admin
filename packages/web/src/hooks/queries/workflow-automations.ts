import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowAutomation } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowAutomationListParams {
  page: number;
  pageSize: number;
  definitionId?: number;
  trigger?: string;
  status?: string;
}

export const workflowAutomationKeys = {
  all: ['workflow', 'automations'] as const,
  lists: ['workflow', 'automations', 'list'] as const,
  list: (params: WorkflowAutomationListParams) => ['workflow', 'automations', 'list', params] as const,
  detail: (id: number | null | undefined) => ['workflow', 'automations', 'detail', id ?? null] as const,
};

export function useWorkflowAutomationList(params: WorkflowAutomationListParams) {
  return useQuery({
    queryKey: workflowAutomationKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowAutomation>>(`/api/workflows/automations${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowAutomationDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowAutomationKeys.detail(id),
    queryFn: () => request.get<WorkflowAutomation>(`/api/workflows/automations/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useSaveWorkflowAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<WorkflowAutomation>(`/api/workflows/automations/${id}`, values) : request.post<WorkflowAutomation>('/api/workflows/automations', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowAutomationKeys.all }),
  });
}

export function useDeleteWorkflowAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/automations/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowAutomationKeys.all }),
  });
}
