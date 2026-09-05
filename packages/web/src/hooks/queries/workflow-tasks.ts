import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, InputOf, PaginatedResponse, QueryOf } from '@zenith/shared/core';
import { workflowInstanceContract, workflowTaskContract, type WorkflowBatchActionResponse, type WorkflowPendingInstanceItem } from '@zenith/shared/workflow';
import { api, useApiMutation } from '@/lib/contract-query';

/** 待办列表项：实例摘要 + 待我处理任务的 SLA / 摘要字段 */
export type PendingWorkflowItem = WorkflowPendingInstanceItem;

export type PendingWorkflowListParams = QueryOf<typeof workflowInstanceContract.pendingMine>;

export const workflowTaskKeys = {
  all: ['workflow', 'tasks'] as const,
  pendingLists: ['workflow', 'tasks', 'pending'] as const,
  pendingList: (params: PendingWorkflowListParams) => ['workflow', 'tasks', 'pending', params] as const,
  consultsMine: ['workflow', 'tasks', 'consults-mine'] as const,
};

export function fetchPendingWorkflowTasks(params: PendingWorkflowListParams) {
  return api(workflowInstanceContract.pendingMine, { query: params }, { silent: true });
}

export function usePendingWorkflowTasks(params: PendingWorkflowListParams) {
  return useQuery({
    queryKey: workflowTaskKeys.pendingList(params),
    queryFn: () => api(workflowInstanceContract.pendingMine, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useMyWorkflowConsults(enabled = true) {
  return useQuery({
    queryKey: workflowTaskKeys.consultsMine,
    queryFn: () => api(workflowTaskContract.myConsults, { query: { pageSize: 50 } }),
    enabled,
  });
}

/** 批量审批会跨越待办 / 已办 / 实例 / 监控多棵子树，统一广播 ['workflow'] */
const invalidateWorkflow = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ['workflow'] });
};

/** 幂等键按选中任务集合生成，重复点击同一批任务不会重复审批 */
export function useBatchApproveWorkflowTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof workflowTaskContract.batchApprove>) =>
      api(workflowTaskContract.batchApprove, { body }, { headers: { 'X-Idempotency-Key': `workflow-batch-approve-${body.taskIds.join('-')}` } }),
    onSuccess: (res) => {
      removeSucceededFromPendingCaches(qc, res);
      return qc.invalidateQueries({ queryKey: ['workflow'] });
    },
  });
}

export function useBatchRejectWorkflowTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof workflowTaskContract.batchReject>) =>
      api(workflowTaskContract.batchReject, { body }, { headers: { 'X-Idempotency-Key': `workflow-batch-reject-${body.taskIds.join('-')}` } }),
    onSuccess: (res) => {
      removeSucceededFromPendingCaches(qc, res);
      return qc.invalidateQueries({ queryKey: ['workflow'] });
    },
  });
}

/** 批量操作成功后：先把成功任务从各待办列表缓存即时移除（行立即消失），再由 invalidate 后台校准 */
function removeSucceededFromPendingCaches(qc: QueryClient, res: WorkflowBatchActionResponse): void {
  const okIds = new Set(res.results.filter((r) => r.success).map((r) => r.taskId));
  if (okIds.size === 0) return;
  qc.setQueriesData<PaginatedResponse<PendingWorkflowItem>>({ queryKey: workflowTaskKeys.pendingLists }, (old) => {
    if (!old) return old;
    const list = old.list.filter((it) => !okIds.has(it.pendingTaskId));
    if (list.length === old.list.length) return old;
    return { ...old, list, total: Math.max(0, old.total - (old.list.length - list.length)) };
  });
}

export function useConsultWorkflowTask() {
  return useApiMutation(workflowTaskContract.consult, { invalidate: invalidateWorkflow });
}

export function useReplyWorkflowConsult() {
  return useApiMutation(workflowTaskContract.replyConsult, { invalidate: invalidateWorkflow });
}

/** 审批详情面板的单任务动作：动作名即幂等键前缀，body 形状由对应契约推导 */
export type WorkflowTaskActionVariables =
  | { taskId: number; action: 'approve'; body: BodyOf<typeof workflowTaskContract.approve> }
  | { taskId: number; action: 'reject'; body: BodyOf<typeof workflowTaskContract.reject> }
  | { taskId: number; action: 'transfer'; body: BodyOf<typeof workflowTaskContract.transfer> }
  | { taskId: number; action: 'delegate'; body: BodyOf<typeof workflowTaskContract.delegate> }
  | { taskId: number; action: 'add-sign'; body: BodyOf<typeof workflowTaskContract.addSign> }
  | { taskId: number; action: 'reduce-sign'; body: BodyOf<typeof workflowTaskContract.reduceSign> }
  | { taskId: number; action: 'return'; body: BodyOf<typeof workflowTaskContract.returnTask> };

/** 幂等键按动作 + 任务生成，防止重复提交；缓存失效由调用方在关闭面板时统一处理 */
export function useWorkflowTaskAction() {
  return useMutation({
    mutationFn: (vars: WorkflowTaskActionVariables): Promise<unknown> => {
      const params = { taskId: vars.taskId };
      const options = { headers: { 'X-Idempotency-Key': `workflow-${vars.action}-${vars.taskId}` } };
      switch (vars.action) {
        case 'approve':
          return api(workflowTaskContract.approve, { params, body: vars.body }, options);
        case 'reject':
          return api(workflowTaskContract.reject, { params, body: vars.body }, options);
        case 'transfer':
          return api(workflowTaskContract.transfer, { params, body: vars.body }, options);
        case 'delegate':
          return api(workflowTaskContract.delegate, { params, body: vars.body }, options);
        case 'add-sign':
          return api(workflowTaskContract.addSign, { params, body: vars.body }, options);
        case 'reduce-sign':
          return api(workflowTaskContract.reduceSign, { params, body: vars.body }, options);
        case 'return':
          return api(workflowTaskContract.returnTask, { params, body: vars.body }, options);
      }
    },
  });
}
