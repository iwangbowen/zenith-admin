import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentNotifyLog } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentLogListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  channel?: string;
  scene?: string;
  signatureValid?: string;
  startTime?: string;
  endTime?: string;
}

export const paymentLogKeys = {
  all: ['payment-logs'] as const,
  lists: ['payment-logs', 'list'] as const,
  list: (params: PaymentLogListParams) => ['payment-logs', 'list', params] as const,
};

export function usePaymentLogList(params: PaymentLogListParams) {
  return useQuery({
    queryKey: paymentLogKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentNotifyLog>>(`/api/payment/logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}
