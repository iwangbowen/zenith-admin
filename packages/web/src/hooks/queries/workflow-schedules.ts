import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowSchedule } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowScheduleListParams {
  page: number;
  pageSize: number;
  definitionId?: number;
  status?: string;
}

export const workflowScheduleKeys = {
  all: ['workflow', 'schedules'] as const,
  lists: ['workflow', 'schedules', 'list'] as const,
  list: (params: WorkflowScheduleListParams) => ['workflow', 'schedules', 'list', params] as const,
};

export function useWorkflowScheduleList(params: WorkflowScheduleListParams) {
  return useQuery({
    queryKey: workflowScheduleKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowSchedule>>(`/api/workflows/schedules${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveWorkflowSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<WorkflowSchedule>(`/api/workflows/schedules/${id}`, values) : request.post<WorkflowSchedule>('/api/workflows/schedules', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowScheduleKeys.all }),
  });
}

export function useDeleteWorkflowSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/schedules/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowScheduleKeys.all }),
  });
}

export function useRunWorkflowSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<WorkflowSchedule>(`/api/workflows/schedules/${id}/run`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}
