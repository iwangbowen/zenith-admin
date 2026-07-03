import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentRefund } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentRefundListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  channel?: string;
  status?: string;
  approvalStatus?: string;
  startTime?: string;
  endTime?: string;
}

export const paymentRefundKeys = {
  all: ['payment-refunds'] as const,
  lists: ['payment-refunds', 'list'] as const,
  list: (params: PaymentRefundListParams) => ['payment-refunds', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-refunds', 'detail', id] as const,
};

export function usePaymentRefundList(params: PaymentRefundListParams) {
  return useQuery({
    queryKey: paymentRefundKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentRefund>>(`/api/payment/refunds${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentRefundDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentRefundKeys.detail(id),
    queryFn: () => request.get<PaymentRefund>(`/api/payment/refunds/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useQueryPaymentRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentRefund>(`/api/payment/refunds/${id}/query`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentRefundKeys.all }),
  });
}

export function useApprovePaymentRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/payment/refunds/${id}/approve`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentRefundKeys.all }),
  });
}

export function useRejectPaymentRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, remark }: { id: number; remark: string }) =>
      request.post<null>(`/api/payment/refunds/${id}/reject`, { remark }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentRefundKeys.all }),
  });
}
