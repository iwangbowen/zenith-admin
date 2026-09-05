import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InputOf, QueryOf } from '@zenith/shared/core';
import { workflowInstanceContract } from '@zenith/shared/workflow';
import { api, useApiMutation } from '@/lib/contract-query';

export type WorkflowInstanceListParams = QueryOf<typeof workflowInstanceContract.list>;

/** 已办 / 抄送列表参数（分页 + 关键字） */
export type WorkflowInstanceKeywordListParams = QueryOf<typeof workflowInstanceContract.handledMine>;

export const workflowInstanceKeys = {
  all: ['workflow', 'instances'] as const,
  lists: ['workflow', 'instances', 'list'] as const,
  list: (params: WorkflowInstanceListParams) => ['workflow', 'instances', 'list', params] as const,
  handled: (params: WorkflowInstanceKeywordListParams) => ['workflow', 'instances', 'handled', params] as const,
  cc: (params: WorkflowInstanceKeywordListParams) => ['workflow', 'instances', 'cc', params] as const,
};

export function useMyWorkflowInstances(params: WorkflowInstanceListParams) {
  return useQuery({
    queryKey: workflowInstanceKeys.list(params),
    queryFn: () => api(workflowInstanceContract.list, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useHandledWorkflowInstances(params: WorkflowInstanceKeywordListParams) {
  return useQuery({
    queryKey: workflowInstanceKeys.handled(params),
    queryFn: () => api(workflowInstanceContract.handledMine, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useCcWorkflowInstances(params: WorkflowInstanceKeywordListParams) {
  return useQuery({
    queryKey: workflowInstanceKeys.cc(params),
    queryFn: () => api(workflowInstanceContract.ccMine, { query: params }),
    placeholderData: keepPreviousData,
  });
}

/** 实例状态变化牵连待办 / 已办 / 抄送 / 监控等多棵子树，统一广播 ['workflow'] */
const invalidateWorkflow = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: ['workflow'] });
};

export type CreateWorkflowInstanceVariables = InputOf<typeof workflowInstanceContract.create> & {
  /** 按表单指纹传入以防连点；缺省由服务端自动指纹兜底 */
  idempotencyKey?: string;
};

export function useCreateWorkflowInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: CreateWorkflowInstanceVariables) =>
      api(workflowInstanceContract.create, { body }, idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow'] }),
  });
}

export function useUpdateWorkflowDraft() {
  return useApiMutation(workflowInstanceContract.updateDraft, { invalidate: invalidateWorkflow });
}

export function useSubmitWorkflowDraft() {
  return useApiMutation(workflowInstanceContract.submitDraft, { invalidate: invalidateWorkflow });
}

export function useDeleteWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.remove, { invalidate: invalidateWorkflow });
}

export function useResubmitWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.resubmit, { invalidate: invalidateWorkflow });
}

export function useWithdrawWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.withdraw, { invalidate: invalidateWorkflow });
}

export function useBatchWithdrawWorkflowInstances() {
  return useApiMutation(workflowInstanceContract.batchWithdraw, { invalidate: invalidateWorkflow });
}

export function useUrgeWorkflowInstance() {
  return useApiMutation(workflowInstanceContract.urge, { invalidate: invalidateWorkflow });
}

export function useBatchUrgeWorkflowInstances() {
  return useApiMutation(workflowInstanceContract.batchUrge, { invalidate: invalidateWorkflow });
}

export function useAddWorkflowCc() {
  return useApiMutation(workflowInstanceContract.addCc, { invalidate: invalidateWorkflow });
}

export function useForwardWorkflowCc() {
  return useApiMutation(workflowInstanceContract.forward, { invalidate: invalidateWorkflow });
}

export function useMarkWorkflowCcRead() {
  return useApiMutation(workflowInstanceContract.ccRead, { invalidate: invalidateWorkflow });
}
