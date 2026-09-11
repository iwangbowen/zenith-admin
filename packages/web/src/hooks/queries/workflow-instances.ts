import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InputOf, QueryOf } from '@zenith/shared/core';
import { workflowInstanceContract } from '@zenith/shared/workflow';
import { api, urlOf, useApiMutation } from '@/lib/contract-query';
import { compactQuery } from '@/lib/query';
import { request } from '@/utils/request';

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

export interface WorkflowInstancePrintPdf {
  blob: Blob;
  filename: string;
  /** archive = 服务端直接返回的归档原件；live = 本次实时渲染 */
  source: 'archive' | 'live';
}

export interface WorkflowInstancePrintOptions {
  /** 临时指定模板（设计器预览）；指定后服务端忽略归档件 */
  templateId?: number;
  /** auto（默认）优先归档件；live 强制按当前版式重渲；archive 只要归档件 */
  source?: 'auto' | 'archive' | 'live';
}

/**
 * 审批单 PDF：预览 / 打印 / 下载共用同一份文件。二进制通道不走 api()，经 request.fetchRaw 取 Blob
 * 与响应头文件名；失败时服务端返回标准 JSON 信封，取其 message 抛出供调用方提示。
 */
export async function fetchWorkflowInstancePrintPdf(id: number, options: WorkflowInstancePrintOptions = {}): Promise<WorkflowInstancePrintPdf> {
  const query = compactQuery({ templateId: options.templateId, source: options.source });
  const res = await request.fetchRaw(urlOf(workflowInstanceContract.print, { params: { id }, query }));
  if (!res) throw new Error('审批单生成失败');
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `审批单生成失败（HTTP ${res.status}）`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return {
    blob,
    filename: match ? decodeURIComponent(match[1]) : `审批单-${id}.pdf`,
    source: res.headers.get('x-zenith-print-source') === 'archive' ? 'archive' : 'live',
  };
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
