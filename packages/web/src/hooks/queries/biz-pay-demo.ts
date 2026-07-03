import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AsyncTask,
  AsyncTaskItem,
  AsyncTaskTypeMeta,
  BizPayDemo,
  BizPayDemoStatus,
  CreatePaymentResult,
  PaginatedResponse,
  PaymentMethod,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface BizPayDemoListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: BizPayDemoStatus;
}

export const bizPayDemoKeys = {
  all: ['biz-pay-demo'] as const,
  lists: ['biz-pay-demo', 'list'] as const,
  list: (params: BizPayDemoListParams) => ['biz-pay-demo', 'list', params] as const,
};

export interface BizTaskDemoItemsParams {
  taskId: number;
  page: number;
  pageSize: number;
}

export const bizTaskDemoKeys = {
  all: ['async-tasks'] as const,
  types: ['async-tasks', 'types'] as const,
  items: ['async-tasks', 'items'] as const,
  itemList: (params: BizTaskDemoItemsParams) => ['async-tasks', 'items', params] as const,
};

export function useBizPayDemoList(params: BizPayDemoListParams) {
  return useQuery({
    queryKey: bizPayDemoKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<BizPayDemo>>(`/api/biz/pay-demos${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCreateBizPayDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { subject: string; amount: number }) =>
      request.post<BizPayDemo>('/api/biz/pay-demos', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizPayDemoKeys.all }),
  });
}

export function usePayBizPayDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payMethod }: { id: number; payMethod: PaymentMethod }) =>
      request
        .post<{ demo: BizPayDemo; payParams: CreatePaymentResult }>(`/api/biz/pay-demos/${id}/pay`, { payMethod })
        .then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizPayDemoKeys.all }),
  });
}

export function useSimulateBizPayDemoPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<BizPayDemo>(`/api/biz/pay-demos/${id}/simulate-paid`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizPayDemoKeys.all }),
  });
}

export function useDeleteBizPayDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/biz/pay-demos/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizPayDemoKeys.all }),
  });
}

export function useSubmitTaskDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values:
      | { taskType: 'demo-batch'; totalItems: number; itemDelayMs: number; failAtItem?: number; failEveryN?: number }
      | { taskType: 'demo-serial'; stageDelayMs: number }) =>
      request.post<AsyncTask>('/api/task-demo/submit', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizTaskDemoKeys.all }),
  });
}

export function useBizTaskDemoTypes() {
  return useQuery({
    queryKey: bizTaskDemoKeys.types,
    queryFn: () => request.get<AsyncTaskTypeMeta[]>('/api/async-tasks/types', { silent: true }).then(unwrap),
  });
}

export function useBizTaskDemoItems(params: BizTaskDemoItemsParams, enabled = true) {
  return useQuery({
    queryKey: bizTaskDemoKeys.itemList(params),
    queryFn: () =>
      request
        .get<PaginatedResponse<AsyncTaskItem>>(
          `/api/async-tasks/${params.taskId}/items${toQueryString({ page: params.page, pageSize: params.pageSize })}`,
          { silent: true },
        )
        .then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useBizTaskDemoAction(action: 'cancel' | 'resume' | 'restart') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<AsyncTask>(`/api/async-tasks/${id}/${action}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: bizTaskDemoKeys.all }),
  });
}
