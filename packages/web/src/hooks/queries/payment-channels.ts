import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentChannelConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentChannelListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  channel?: string;
  status?: string;
}

export interface PaymentChannelTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export const paymentChannelKeys = {
  all: ['payment-channels'] as const,
  lists: ['payment-channels', 'list'] as const,
  list: (params: PaymentChannelListParams) => ['payment-channels', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-channels', 'detail', id] as const,
};

export function usePaymentChannelList(params: PaymentChannelListParams) {
  return useQuery({
    queryKey: paymentChannelKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentChannelConfig>>(`/api/payment/channels${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentChannelDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentChannelKeys.detail(id),
    queryFn: () => request.get<PaymentChannelConfig>(`/api/payment/channels/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSavePaymentChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<PaymentChannelConfig>('/api/payment/channels', values)
        : request.put<PaymentChannelConfig>(`/api/payment/channels/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentChannelKeys.all }),
  });
}

export function useDeletePaymentChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/channels/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentChannelKeys.all }),
  });
}

export function useTestPaymentChannel() {
  return useMutation({
    mutationFn: (id: number) =>
      request.post<PaymentChannelTestResult>(`/api/payment/channels/${id}/test`, {}).then(unwrap),
  });
}

export function useSetDefaultPaymentChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/payment/channels/${id}/default`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentChannelKeys.all }),
  });
}
