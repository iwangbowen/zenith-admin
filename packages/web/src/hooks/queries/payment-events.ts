import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentOutboxEvent } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentEventListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  type?: string;
}

export interface PaymentOpsHealth {
  outboxPending: number;
  outboxFailed: number;
  webhookPending: number;
  webhookFailed24h: number;
  sharingProcessing: number;
  transferProcessing: number;
  reconPendingDiff: number;
}

export const paymentEventKeys = {
  all: ['payment-events'] as const,
  lists: ['payment-events', 'list'] as const,
  list: (params: PaymentEventListParams) => ['payment-events', 'list', params] as const,
  health: ['payment-events', 'health'] as const,
};

export function usePaymentEventList(params: PaymentEventListParams) {
  return useQuery({
    queryKey: paymentEventKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentOutboxEvent>>(`/api/payment/ops/events${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useRedispatchPaymentEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentOutboxEvent>(`/api/payment/ops/events/${id}/redispatch`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentEventKeys.all }),
  });
}

export function usePaymentOpsHealth(enabled = true) {
  return useQuery({
    queryKey: paymentEventKeys.health,
    queryFn: () => request.get<PaymentOpsHealth>('/api/payment/ops/health').then(unwrap),
    refetchInterval: 30000,
    enabled,
  });
}
