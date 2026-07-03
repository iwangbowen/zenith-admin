import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowDataSource, WorkflowDataSourceOption } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowDataSourceListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const workflowDataSourceKeys = {
  all: ['workflow', 'data-sources'] as const,
  lists: ['workflow', 'data-sources', 'list'] as const,
  list: (params: WorkflowDataSourceListParams) => ['workflow', 'data-sources', 'list', params] as const,
};

export function useWorkflowDataSourceList(params: WorkflowDataSourceListParams) {
  return useQuery({
    queryKey: workflowDataSourceKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowDataSource>>(`/api/workflows/data-sources${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveWorkflowDataSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<WorkflowDataSource>(`/api/workflows/data-sources/${id}`, values) : request.post<WorkflowDataSource>('/api/workflows/data-sources', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowDataSourceKeys.all }),
  });
}

export function useDeleteWorkflowDataSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/data-sources/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowDataSourceKeys.all }),
  });
}

export function useTestWorkflowDataSource() {
  return useMutation({
    mutationFn: (id: number) =>
      request.get<WorkflowDataSourceOption[]>(`/api/workflows/data-sources/${id}/options`, { silent: true }).then(unwrap),
  });
}
