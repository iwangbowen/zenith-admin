import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentFeeRule } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentFeeRuleListParams {
  page: number;
  pageSize: number;
  channel?: string;
  status?: string;
}

export const paymentFeeKeys = {
  all: ['payment-fee'] as const,
  lists: ['payment-fee', 'list'] as const,
  list: (params: PaymentFeeRuleListParams) => ['payment-fee', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-fee', 'detail', id] as const,
};

export function usePaymentFeeRuleList(params: PaymentFeeRuleListParams) {
  return useQuery({
    queryKey: paymentFeeKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentFeeRule>>(`/api/payment/fee-rules${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSavePaymentFeeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<PaymentFeeRule> }) =>
      (id === undefined
        ? request.post<PaymentFeeRule>('/api/payment/fee-rules', values)
        : request.put<PaymentFeeRule>(`/api/payment/fee-rules/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentFeeKeys.all }),
  });
}

export function useDeletePaymentFeeRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/fee-rules/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentFeeKeys.all }),
  });
}
