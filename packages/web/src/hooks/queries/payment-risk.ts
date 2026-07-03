import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentRiskRule } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentRiskRuleListParams {
  page: number;
  pageSize: number;
  scope?: string;
  status?: string;
}

export const paymentRiskKeys = {
  all: ['payment-risk'] as const,
  lists: ['payment-risk', 'list'] as const,
  list: (params: PaymentRiskRuleListParams) => ['payment-risk', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-risk', 'detail', id] as const,
};

export function usePaymentRiskRuleList(params: PaymentRiskRuleListParams) {
  return useQuery({
    queryKey: paymentRiskKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentRiskRule>>(`/api/payment/risk-rules${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSavePaymentRiskRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<PaymentRiskRule> }) =>
      (id === undefined
        ? request.post<PaymentRiskRule>('/api/payment/risk-rules', values)
        : request.put<PaymentRiskRule>(`/api/payment/risk-rules/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentRiskKeys.all }),
  });
}

export function useDeletePaymentRiskRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/risk-rules/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentRiskKeys.all }),
  });
}
