import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentSharingOrder, PaymentSharingReceiver } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface PaymentSharingReceiverListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export interface PaymentSharingOrderListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const paymentSharingKeys = {
  all: ['payment-sharing'] as const,
  receiverLists: ['payment-sharing', 'receivers', 'list'] as const,
  receiverList: (params: PaymentSharingReceiverListParams) => ['payment-sharing', 'receivers', 'list', params] as const,
  orderLists: ['payment-sharing', 'orders', 'list'] as const,
  orderList: (params: PaymentSharingOrderListParams) => ['payment-sharing', 'orders', 'list', params] as const,
  enabledReceivers: ['payment-sharing', 'receivers', 'enabled'] as const,
  detail: (id: number | undefined) => ['payment-sharing', 'detail', id] as const,
};

export function usePaymentSharingReceivers(params: PaymentSharingReceiverListParams) {
  return useQuery({
    queryKey: paymentSharingKeys.receiverList(params),
    queryFn: () => request.get<PaginatedResponse<PaymentSharingReceiver>>(`/api/payment/sharing/receivers${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentSharingOrders(params: PaymentSharingOrderListParams) {
  return useQuery({
    queryKey: paymentSharingKeys.orderList(params),
    queryFn: () => request.get<PaginatedResponse<PaymentSharingOrder>>(`/api/payment/sharing/orders${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useEnabledPaymentSharingReceivers(enabled = true) {
  return useQuery({
    queryKey: paymentSharingKeys.enabledReceivers,
    queryFn: () =>
      request
        .get<PaginatedResponse<PaymentSharingReceiver>>('/api/payment/sharing/receivers?page=1&pageSize=100&status=enabled')
        .then(unwrap)
        .then((data) => data.list.filter((r) => r.status === 'enabled')),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

export function useSavePaymentSharingReceiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<PaymentSharingReceiver> }) =>
      (id === undefined
        ? request.post<PaymentSharingReceiver>('/api/payment/sharing/receivers', values)
        : request.put<PaymentSharingReceiver>(`/api/payment/sharing/receivers/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentSharingKeys.all }),
  });
}

export function useDeletePaymentSharingReceiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/sharing/receivers/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentSharingKeys.all }),
  });
}

export function useCreatePaymentSharingOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { orderNo: string; receiverId: number; amount?: number; remark?: string }) =>
      request.post<PaymentSharingOrder>('/api/payment/sharing/orders', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentSharingKeys.all }),
  });
}
