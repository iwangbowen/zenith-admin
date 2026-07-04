import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentApp } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentAppListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const paymentAppKeys = {
  all: ['payment-apps'] as const,
  lists: ['payment-apps', 'list'] as const,
  list: (params: PaymentAppListParams) => ['payment-apps', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-apps', 'detail', id] as const,
};

export function usePaymentAppList(params: PaymentAppListParams) {
  return useQuery({
    queryKey: paymentAppKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentApp>>(`/api/payment/apps${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSavePaymentApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<PaymentApp> }) =>
      (id === undefined
        ? request.post<PaymentApp>('/api/payment/apps', values)
        : request.put<PaymentApp>(`/api/payment/apps/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentAppKeys.all }),
  });
}

export function useDeletePaymentApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/apps/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentAppKeys.all }),
  });
}
