import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowForm } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowFormListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  categoryId?: number;
}

export const workflowFormKeys = {
  all: ['workflow', 'forms'] as const,
  lists: ['workflow', 'forms', 'list'] as const,
  list: (params: WorkflowFormListParams) => ['workflow', 'forms', 'list', params] as const,
  detail: (id: number | null | undefined) => ['workflow', 'forms', 'detail', id ?? null] as const,
};

export function useWorkflowFormList(params: WorkflowFormListParams) {
  return useQuery({
    queryKey: workflowFormKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<WorkflowForm>>(`/api/workflows/forms${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowFormDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowFormKeys.detail(id),
    queryFn: () => request.get<WorkflowForm>(`/api/workflows/forms/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useSaveWorkflowForm() {
  const qc = useQueryClient();
  return useMutation({
    // silent：错误交由调用方处理（409 乐观锁冲突需弹窗引导，而非通用 toast）
    mutationFn: ({ id, values }: { id?: number | null; values: Record<string, unknown> }) =>
      (id
        ? request.put<WorkflowForm>(`/api/workflows/forms/${id}`, values, { silent: true })
        : request.post<WorkflowForm>('/api/workflows/forms', values, { silent: true })
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowFormKeys.all }),
  });
}

export function useDeleteWorkflowForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/forms/${id}`, undefined, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowFormKeys.all }),
  });
}

export function useDuplicateWorkflowForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<WorkflowForm>(`/api/workflows/forms/${id}/duplicate`, {}, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowFormKeys.all }),
  });
}
