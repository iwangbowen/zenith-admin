import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, WorkflowDefinition, WorkflowInstance, WorkflowInstanceSummaryItem, WorkflowTaskConsult, WorkflowSlaLevel } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export type PendingWorkflowItem = WorkflowInstance & {
  pendingTaskId: number;
  pendingSignatureRequired?: boolean;
  requiresIndividual?: boolean;
  slaLevel?: WorkflowSlaLevel;
  slaOverdueSec?: number | null;
  slaDeadline?: string | null;
  /** 列表摘要（流程「更多设置 → 列表摘要字段」配置） */
  summary?: WorkflowInstanceSummaryItem[];
};

export interface PendingWorkflowListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  definitionId?: number;
}

export const workflowTaskKeys = {
  all: ['workflow', 'tasks'] as const,
  pendingLists: ['workflow', 'tasks', 'pending'] as const,
  pendingList: (params: PendingWorkflowListParams) => ['workflow', 'tasks', 'pending', params] as const,
  consultsMine: ['workflow', 'tasks', 'consults-mine'] as const,
};

export function fetchPendingWorkflowTasks(params: PendingWorkflowListParams) {
  return request.get<PaginatedResponse<PendingWorkflowItem>>(`/api/workflows/instances/pending-mine${toQueryString(params)}`, { silent: true }).then(unwrap);
}

export function usePendingWorkflowTasks(params: PendingWorkflowListParams) {
  return useQuery({
    queryKey: workflowTaskKeys.pendingList(params),
    queryFn: () => request.get<PaginatedResponse<PendingWorkflowItem>>(`/api/workflows/instances/pending-mine${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowTaskDefinitions() {
  return useQuery({
    queryKey: ['workflow', 'tasks', 'definitions'],
    queryFn: () => request.get<WorkflowDefinition[]>('/api/workflows/definitions/published').then(unwrap),
  });
}

export function useMyWorkflowConsults(enabled = true) {
  return useQuery({
    queryKey: workflowTaskKeys.consultsMine,
    queryFn: () =>
      request.get<PaginatedResponse<WorkflowTaskConsult>>('/api/workflows/instances/consults/mine?pageSize=50').then(unwrap),
    enabled,
  });
}

export function useBatchApproveWorkflowTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskIds, comment }: { taskIds: number[]; comment?: string }) =>
      request
        .post<WorkflowBatchTaskResult>(
          '/api/workflows/tasks/batch-approve',
          { taskIds, comment },
          { headers: { 'X-Idempotency-Key': `workflow-batch-approve-${taskIds.join('-')}` } },
        )
        .then(unwrap),
    onSuccess: (res) => {
      removeSucceededFromPendingCaches(qc, res);
      return qc.invalidateQueries({ queryKey: ['workflow'] });
    },
  });
}

export function useBatchRejectWorkflowTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskIds, comment }: { taskIds: number[]; comment: string }) =>
      request
        .post<WorkflowBatchTaskResult>(
          '/api/workflows/tasks/batch-reject',
          { taskIds, comment },
          { headers: { 'X-Idempotency-Key': `workflow-batch-reject-${taskIds.join('-')}` } },
        )
        .then(unwrap),
    onSuccess: (res) => {
      removeSucceededFromPendingCaches(qc, res);
      return qc.invalidateQueries({ queryKey: ['workflow'] });
    },
  });
}

type WorkflowBatchTaskResult = { succeeded: number; failed: number; results?: Array<{ taskId: number; success: boolean; message?: string }> };

/** 批量操作成功后：先把成功任务从各待办列表缓存即时移除（行立即消失），再由 invalidate 后台校准 */
function removeSucceededFromPendingCaches(qc: QueryClient, res: WorkflowBatchTaskResult): void {
  const okIds = new Set((res.results ?? []).filter((r) => r.success).map((r) => r.taskId));
  if (okIds.size === 0) return;
  qc.setQueriesData<PaginatedResponse<PendingWorkflowItem>>({ queryKey: workflowTaskKeys.pendingLists }, (old) => {
    if (!old) return old;
    const list = old.list.filter((it) => !okIds.has(it.pendingTaskId));
    if (list.length === old.list.length) return old;
    return { ...old, list, total: Math.max(0, old.total - (old.list.length - list.length)) };
  });
}

export function useConsultWorkflowTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, consulteeIds, question }: { taskId: number; consulteeIds: number[]; question?: string }) =>
      request.post<unknown>(`/api/workflows/tasks/${taskId}/consult`, { consulteeIds, question }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}

export function useReplyWorkflowConsult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, opinion }: { id: number; opinion: string }) =>
      request.post<unknown>(`/api/workflows/instances/consults/${id}/reply`, { opinion }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}
