/**
 * 移动审批轻页域 hooks（独立 QueryClient，不与 admin/member 混用）
 */
import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceSummaryItem,
  WorkflowSlaLevel,
} from '@zenith/shared';
import { approvalRequest, unwrapApproval } from './approval-request';

export const approvalQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

export type ApprovalTab = 'pending' | 'handled' | 'mine';

export type ApprovalListItem = WorkflowInstance & {
  pendingTaskId?: number;
  requiresIndividual?: boolean;
  slaLevel?: WorkflowSlaLevel;
  slaOverdueSec?: number | null;
  slaDeadline?: string | null;
  summary?: WorkflowInstanceSummaryItem[];
};

const TAB_ENDPOINT: Record<ApprovalTab, string> = {
  pending: '/api/workflows/instances/pending-mine',
  handled: '/api/workflows/instances/handled-mine',
  mine: '/api/workflows/instances',
};

export const approvalKeys = {
  all: ['approval'] as const,
  list: (tab: ApprovalTab, size: number) => ['approval', 'list', tab, size] as const,
  lists: ['approval', 'list'] as const,
  detail: (id: number | null) => ['approval', 'detail', id] as const,
  definitions: ['approval', 'definitions'] as const,
  me: ['approval', 'me'] as const,
};

/** 累积加载：固定 page=1、递增 pageSize（移动端"加载更多"语义，缓存 key 稳定） */
export function useApprovalList(tab: ApprovalTab, size: number) {
  return useQuery({
    queryKey: approvalKeys.list(tab, size),
    queryFn: () =>
      approvalRequest
        .get<PaginatedResponse<ApprovalListItem>>(`${TAB_ENDPOINT[tab]}?page=1&pageSize=${size}`)
        .then(unwrapApproval),
    placeholderData: keepPreviousData,
    refetchInterval: tab === 'pending' ? 30_000 : false,
  });
}

export function useApprovalDetail(id: number | null) {
  return useQuery({
    queryKey: approvalKeys.detail(id),
    queryFn: () => approvalRequest.get<WorkflowInstance>(`/api/workflows/instances/${id}`).then(unwrapApproval),
    enabled: id != null,
  });
}

export function useApprovalMe() {
  return useQuery({
    queryKey: approvalKeys.me,
    queryFn: () => approvalRequest.get<{ id: number; username: string; nickname: string | null }>('/api/auth/me', { silent: true }).then(unwrapApproval),
    retry: false,
  });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, action, body }: { taskId: number; action: 'approve' | 'reject' | 'transfer'; body: Record<string, unknown> }) =>
      approvalRequest
        .post<WorkflowInstance>(`/api/workflows/tasks/${taskId}/${action}`, body, {
          headers: { 'X-Idempotency-Key': `approval-${action}-${taskId}` },
        })
        .then(unwrapApproval),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}

export function usePublishedDefinitions() {
  return useQuery({
    queryKey: approvalKeys.definitions,
    queryFn: () => approvalRequest.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then(unwrapApproval),
    staleTime: 60_000,
  });
}

export function useLaunchInstance() {
  const qc = useQueryClient();
  return useMutation({
    // 幂等由服务端自动指纹（userId+path+bodyHash）兜底，前端按钮 loading 防连点
    mutationFn: (values: Record<string, unknown>) =>
      approvalRequest.post<WorkflowInstance>('/api/workflows/instances', values).then(unwrapApproval),
    onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}
