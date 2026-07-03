import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentSettlementBatch, PaymentSettlementStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentSettlementListParams {
  page: number;
  pageSize: number;
  channel?: string;
  status?: string;
}

export const paymentSettlementKeys = {
  all: ['payment-settlements'] as const,
  lists: ['payment-settlements', 'list'] as const,
  list: (params: PaymentSettlementListParams) => ['payment-settlements', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-settlements', 'detail', id] as const,
};

export function usePaymentSettlementList(params: PaymentSettlementListParams) {
  return useQuery({
    queryKey: paymentSettlementKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentSettlementBatch>>(`/api/payment/settlements${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useGeneratePaymentSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { channel: string; periodStart: string; periodEnd: string; remark?: string }) =>
      request.post<PaymentSettlementBatch>('/api/payment/settlements/generate', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentSettlementKeys.all }),
  });
}

export function useUpdatePaymentSettlementStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: PaymentSettlementStatus }) =>
      request.post<PaymentSettlementBatch>(`/api/payment/settlements/${id}/status`, { status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentSettlementKeys.all }),
  });
}
