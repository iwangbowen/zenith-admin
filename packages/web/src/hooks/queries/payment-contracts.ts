import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentContract, PaymentDeductPlan } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentContractListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  channel?: string;
  planId?: number;
  startTime?: string;
  endTime?: string;
}

export interface DeductPlanListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export interface DeductResult {
  orderNo?: string | null;
  deductStatus: 'success' | 'processing' | 'failed';
  failReason?: string | null;
}

export interface SignContractResult {
  contract: PaymentContract;
  firstDeduct?: DeductResult | null;
}

export const paymentContractKeys = {
  all: ['payment-contracts'] as const,
  lists: ['payment-contracts', 'list'] as const,
  list: (params: PaymentContractListParams) => ['payment-contracts', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-contracts', 'detail', id] as const,
  planAll: ['payment-contracts', 'plans'] as const,
  planLists: ['payment-contracts', 'plans', 'list'] as const,
  planList: (params: DeductPlanListParams) => ['payment-contracts', 'plans', 'list', params] as const,
  planOptions: ['payment-contracts', 'plans', 'options'] as const,
};

// ─── 签约协议 ─────────────────────────────────────────────────────────────────

export function usePaymentContractList(params: PaymentContractListParams) {
  return useQuery({
    queryKey: paymentContractKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentContract>>(`/api/payment/contracts${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCreatePaymentContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { planId: number; payMethod: string; signerAccount: string; signerName?: string; remark?: string; firstDeductNow: boolean }) =>
      request.post<SignContractResult>('/api/payment/contracts', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

export function useTerminatePaymentContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentContract>(`/api/payment/contracts/${id}/terminate`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

export function usePausePaymentContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentContract>(`/api/payment/contracts/${id}/pause`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

export function useResumePaymentContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentContract>(`/api/payment/contracts/${id}/resume`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

export function useDeductPaymentContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<DeductResult & { contract: PaymentContract }>(`/api/payment/contracts/${id}/deduct`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

// ─── 扣款计划 ─────────────────────────────────────────────────────────────────

export function useDeductPlanList(params: DeductPlanListParams) {
  return useQuery({
    queryKey: paymentContractKeys.planList(params),
    queryFn: () => request.get<PaginatedResponse<PaymentDeductPlan>>(`/api/payment/deduct-plans${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAllDeductPlans() {
  return useQuery({
    queryKey: paymentContractKeys.planOptions,
    queryFn: () => request.get<PaymentDeductPlan[]>('/api/payment/deduct-plans/all').then(unwrap),
  });
}

export function useCreateDeductPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<PaymentDeductPlan>) => request.post<PaymentDeductPlan>('/api/payment/deduct-plans', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

export function useUpdateDeductPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<PaymentDeductPlan> }) =>
      request.put<PaymentDeductPlan>(`/api/payment/deduct-plans/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}

export function useDeleteDeductPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete(`/api/payment/deduct-plans/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentContractKeys.all }),
  });
}
