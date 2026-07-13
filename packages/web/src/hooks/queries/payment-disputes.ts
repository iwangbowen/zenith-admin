import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentDispute, PaymentDisputeDetail, PaymentDisputeStats } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentDisputeListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  channel?: string;
  type?: string;
  overdueOnly?: boolean;
  startTime?: string;
  endTime?: string;
}

export const paymentDisputeKeys = {
  all: ['payment-disputes'] as const,
  lists: ['payment-disputes', 'list'] as const,
  list: (params: PaymentDisputeListParams) => ['payment-disputes', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-disputes', 'detail', id] as const,
  stats: ['payment-disputes', 'stats'] as const,
};

export function usePaymentDisputeList(params: PaymentDisputeListParams) {
  return useQuery({
    queryKey: paymentDisputeKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentDispute>>(`/api/payment/disputes${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentDisputeStats() {
  return useQuery({
    queryKey: paymentDisputeKeys.stats,
    queryFn: () => request.get<PaymentDisputeStats>('/api/payment/disputes/stats').then(unwrap),
  });
}

export function usePaymentDisputeDetail(id: number | undefined) {
  return useQuery({
    queryKey: paymentDisputeKeys.detail(id),
    queryFn: () => request.get<PaymentDisputeDetail>(`/api/payment/disputes/${id}`).then(unwrap),
    enabled: id != null,
  });
}

export function useReplyPaymentDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      request.post<PaymentDisputeDetail>(`/api/payment/disputes/${id}/reply`, { content }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentDisputeKeys.all }),
  });
}

export function useResolvePaymentDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, remark }: { id: number; remark?: string }) =>
      request.post<PaymentDisputeDetail>(`/api/payment/disputes/${id}/resolve`, { remark }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentDisputeKeys.all }),
  });
}

export function useRefundPaymentDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, refundAmount, reason }: { id: number; refundAmount?: number; reason?: string }) =>
      request.post<PaymentDisputeDetail>(`/api/payment/disputes/${id}/refund`, { refundAmount, reason }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentDisputeKeys.all }),
  });
}

export function useSimulatePaymentDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderNo?: string) => request.post<PaymentDispute>('/api/payment/disputes/simulate', { orderNo }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentDisputeKeys.all }),
  });
}
