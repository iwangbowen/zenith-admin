import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowInstance } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowInstanceListParams {
  page: number;
  pageSize: number;
  status?: string;
  priority?: string;
  keyword?: string;
}

export type WorkflowInstanceBatchActionResponse = {
  succeeded: number;
  failed: number;
  results: Array<{ instanceId: number; success: boolean; message?: string }>;
};

export const workflowInstanceKeys = {
  all: ['workflow', 'instances'] as const,
  lists: ['workflow', 'instances', 'list'] as const,
  list: (params: WorkflowInstanceListParams) => ['workflow', 'instances', 'list', params] as const,
  handled: (params: WorkflowInstanceListParams) => ['workflow', 'instances', 'handled', params] as const,
  cc: (params: WorkflowInstanceListParams) => ['workflow', 'instances', 'cc', params] as const,
};

export function useMyWorkflowInstances(params: WorkflowInstanceListParams) {
  return useQuery({
    queryKey: workflowInstanceKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useHandledWorkflowInstances(params: WorkflowInstanceListParams) {
  return useQuery({
    queryKey: workflowInstanceKeys.handled(params),
    queryFn: () => request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances/handled-mine${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCcWorkflowInstances(params: WorkflowInstanceListParams) {
  return useQuery({
    queryKey: workflowInstanceKeys.cc(params),
    queryFn: () => request.get<PaginatedResponse<WorkflowInstance>>(`/api/workflows/instances/cc-mine${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

function useWorkflowInvalidatingMutation<TVariables, TData = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}

export function useCreateWorkflowInstance() {
  return useWorkflowInvalidatingMutation(
    ({ values, idempotencyKey }: { values: Record<string, unknown>; idempotencyKey?: string }) =>
      request
        .post<WorkflowInstance>(
          '/api/workflows/instances',
          values,
          idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : undefined,
        )
        .then(unwrap),
  );
}

export function useUpdateWorkflowDraft() {
  return useWorkflowInvalidatingMutation(({ id, values }: { id: number; values: Record<string, unknown> }) =>
    request.put<unknown>(`/api/workflows/instances/${id}/draft`, values).then(unwrap));
}

export function useSubmitWorkflowDraft() {
  return useWorkflowInvalidatingMutation(({ id, values }: { id: number; values?: Record<string, unknown> }) =>
    request.post<unknown>(`/api/workflows/instances/${id}/submit`, values ?? {}).then(unwrap));
}

export function useDeleteWorkflowInstance() {
  return useWorkflowInvalidatingMutation((id: number) =>
    request.delete<unknown>(`/api/workflows/instances/${id}`).then(unwrap));
}

export function useResubmitWorkflowInstance() {
  return useWorkflowInvalidatingMutation((id: number) =>
    request.post<WorkflowInstance>(`/api/workflows/instances/${id}/resubmit`, {}).then(unwrap));
}

export function useWithdrawWorkflowInstance() {
  return useWorkflowInvalidatingMutation(({ id, comment }: { id: number; comment?: string }) =>
    request.post<unknown>(`/api/workflows/instances/${id}/withdraw`, comment ? { comment } : {}).then(unwrap));
}

export function useBatchWithdrawWorkflowInstances() {
  return useWorkflowInvalidatingMutation(({ instanceIds, comment }: { instanceIds: number[]; comment?: string }) =>
    request.post<WorkflowInstanceBatchActionResponse>('/api/workflows/instances/batch-withdraw', { instanceIds, comment }).then(unwrap));
}

export function useUrgeWorkflowInstance() {
  return useWorkflowInvalidatingMutation(({ id, message }: { id: number; message?: string }) =>
    request.post<unknown>(`/api/workflows/instances/${id}/urge`, { message }).then(unwrap));
}

export function useBatchUrgeWorkflowInstances() {
  return useWorkflowInvalidatingMutation(({ instanceIds, message }: { instanceIds: number[]; message?: string }) =>
    request.post<WorkflowInstanceBatchActionResponse>('/api/workflows/instances/batch-urge', { instanceIds, message }).then(unwrap));
}

export function useAddWorkflowCc() {
  return useWorkflowInvalidatingMutation(({ id, nodeKey, userIds }: { id: number; nodeKey: string; userIds: number[] }) =>
    request.post<unknown>(`/api/workflows/instances/${id}/cc/add`, { nodeKey, userIds }).then(unwrap));
}

export function useForwardWorkflowCc() {
  return useWorkflowInvalidatingMutation(({ id, userIds, note }: { id: number; userIds: number[]; note?: string }) =>
    request.post<unknown>(`/api/workflows/instances/${id}/forward`, { userIds, note }).then(unwrap));
}

export function useMarkWorkflowCcRead() {
  return useWorkflowInvalidatingMutation((ccTaskId: number) =>
    request.post<unknown>(`/api/workflows/instances/cc/${ccTaskId}/read`, {}).then(unwrap));
}
