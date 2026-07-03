import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  WorkflowConnector,
  WorkflowConnectorInvocation,
  WorkflowConnectorInvokeResult,
  WorkflowConnectorStats,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface WorkflowConnectorListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: string;
  status?: string;
}

export const workflowConnectorKeys = {
  all: ['workflow', 'connectors'] as const,
  lists: ['workflow', 'connectors', 'list'] as const,
  list: (params: WorkflowConnectorListParams) => ['workflow', 'connectors', 'list', params] as const,
  monitor: (id: number | null | undefined, days: number) => ['workflow', 'connectors', 'monitor', id ?? null, days] as const,
};

export function useWorkflowConnectorList(params: WorkflowConnectorListParams) {
  return useQuery({
    queryKey: workflowConnectorKeys.list(params),
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowConnector>>(`/api/workflows/connectors${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowConnectorMonitor(id: number | null | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: workflowConnectorKeys.monitor(id, days),
    queryFn: async () => {
      const [stats, invocations] = await Promise.all([
        request.get<WorkflowConnectorStats>(`/api/workflows/connectors/${id}/stats${toQueryString({ days })}`, { silent: true }).then(unwrap),
        request.get<WorkflowConnectorInvocation[]>(`/api/workflows/connectors/${id}/invocations${toQueryString({ limit: 50 })}`, { silent: true }).then(unwrap),
      ]);
      return { stats, invocations };
    },
    enabled: enabled && !!id,
  });
}

export function useSaveWorkflowConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<WorkflowConnector>(`/api/workflows/connectors/${id}`, values) : request.post<WorkflowConnector>('/api/workflows/connectors', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowConnectorKeys.all }),
  });
}

export function useDeleteWorkflowConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/workflows/connectors/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowConnectorKeys.all }),
  });
}

export function useTestWorkflowConnector() {
  return useMutation({
    mutationFn: ({ id, path }: { id: number; path?: string }) =>
      request.post<WorkflowConnectorInvokeResult>(`/api/workflows/connectors/${id}/test`, path ? { path } : {}, { silent: true }).then(unwrap),
  });
}
