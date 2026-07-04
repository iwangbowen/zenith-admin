import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentReconBatch, PaymentReconItem } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentReconBatchListParams {
  page: number;
  pageSize: number;
  channel?: string;
  status?: string;
}

export interface PaymentReconItemListParams {
  batchId?: number;
  page: number;
  pageSize: number;
  result?: string;
}

export const paymentReconKeys = {
  all: ['payment-recon'] as const,
  lists: ['payment-recon', 'list'] as const,
  list: (params: PaymentReconBatchListParams) => ['payment-recon', 'list', params] as const,
  items: (params: PaymentReconItemListParams) => ['payment-recon', 'items', params] as const,
  detail: (id: number | undefined) => ['payment-recon', 'detail', id] as const,
};

export function usePaymentReconBatchList(params: PaymentReconBatchListParams) {
  return useQuery({
    queryKey: paymentReconKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentReconBatch>>(`/api/payment/recon/batches${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentReconItems(params: PaymentReconItemListParams, enabled = true) {
  const { batchId, ...query } = params;
  return useQuery({
    queryKey: paymentReconKeys.items({ batchId, ...query }),
    queryFn: () => request.get<PaginatedResponse<PaymentReconItem>>(`/api/payment/recon/batches/${batchId}/items${toQueryString(query)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: enabled && batchId !== undefined,
  });
}

export function usePaymentReconSampleBill() {
  return useMutation({
    mutationFn: (params: { channel: string; billDate: string }) =>
      request.get<{ billText: string }>(`/api/payment/recon/sample-bill${toQueryString(params)}`).then(unwrap),
  });
}

export function useCreatePaymentReconBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { channel: string; billDate: string; billText: string; remark?: string }) =>
      request.post<PaymentReconBatch>('/api/payment/recon/batches', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentReconKeys.all }),
  });
}

export function useDeletePaymentReconBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/payment/recon/batches/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentReconKeys.all }),
  });
}
