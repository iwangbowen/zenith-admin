import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentPreauth } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentPreauthListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  channel?: string;
}

export const paymentPreauthKeys = {
  all: ['payment-preauths'] as const,
  lists: ['payment-preauths', 'list'] as const,
  list: (params: PaymentPreauthListParams) => ['payment-preauths', 'list', params] as const,
};

export function usePaymentPreauthList(params: PaymentPreauthListParams) {
  return useQuery({
    queryKey: paymentPreauthKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentPreauth>>(`/api/payment/preauths${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCreatePaymentPreauth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { payMethod: string; payerAccount: string; subject: string; frozenAmount: number; bizType?: string; remark?: string }) =>
      request.post<PaymentPreauth>('/api/payment/preauths', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentPreauthKeys.all }),
  });
}

export function useCapturePaymentPreauth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, captureAmount }: { id: number; captureAmount?: number }) =>
      request.post<PaymentPreauth>(`/api/payment/preauths/${id}/capture`, { captureAmount }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentPreauthKeys.all }),
  });
}

export function useReleasePaymentPreauth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentPreauth>(`/api/payment/preauths/${id}/release`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentPreauthKeys.all }),
  });
}
