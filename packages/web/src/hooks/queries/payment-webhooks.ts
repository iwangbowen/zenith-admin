import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentWebhookDelivery, PaymentWebhookEndpoint } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentWebhookEndpointListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export interface PaymentWebhookDeliveryListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const paymentWebhookKeys = {
  all: ['payment-webhooks'] as const,
  endpointLists: ['payment-webhooks', 'endpoints', 'list'] as const,
  endpointList: (params: PaymentWebhookEndpointListParams) => ['payment-webhooks', 'endpoints', 'list', params] as const,
  deliveryLists: ['payment-webhooks', 'deliveries', 'list'] as const,
  deliveryList: (params: PaymentWebhookDeliveryListParams) => ['payment-webhooks', 'deliveries', 'list', params] as const,
  endpointDetail: (id: number | undefined) => ['payment-webhooks', 'endpoints', 'detail', id] as const,
  detail: (id: number | undefined) => ['payment-webhooks', 'detail', id] as const,
};

export function usePaymentWebhookEndpoints(params: PaymentWebhookEndpointListParams) {
  return useQuery({
    queryKey: paymentWebhookKeys.endpointList(params),
    queryFn: () => request.get<PaginatedResponse<PaymentWebhookEndpoint>>(`/api/payment/webhooks/endpoints${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentWebhookDeliveries(params: PaymentWebhookDeliveryListParams) {
  return useQuery({
    queryKey: paymentWebhookKeys.deliveryList(params),
    queryFn: () => request.get<PaginatedResponse<PaymentWebhookDelivery>>(`/api/payment/webhooks/deliveries${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentWebhookEndpointDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentWebhookKeys.endpointDetail(id),
    queryFn: () => request.get<PaymentWebhookEndpoint>(`/api/payment/webhooks/endpoints/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSavePaymentWebhookEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<PaymentWebhookEndpoint> & { secret?: string } }) =>
      (id === undefined
        ? request.post<PaymentWebhookEndpoint>('/api/payment/webhooks/endpoints', values)
        : request.put<PaymentWebhookEndpoint>(`/api/payment/webhooks/endpoints/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentWebhookKeys.all }),
  });
}

export function useDeletePaymentWebhookEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/webhooks/endpoints/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentWebhookKeys.all }),
  });
}

export function useRedeliverPaymentWebhookDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentWebhookDelivery>(`/api/payment/webhooks/deliveries/${id}/redeliver`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentWebhookKeys.all }),
  });
}
