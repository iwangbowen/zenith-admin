import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaginatedResponse, PaymentLedgerEntry, PaymentLedgerSummary } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentLedgerFilterParams {
  keyword?: string;
  direction?: string;
  type?: string;
  channel?: string;
  startTime?: string;
  endTime?: string;
}

export interface PaymentLedgerListParams extends PaymentLedgerFilterParams {
  page: number;
  pageSize: number;
}

export const paymentLedgerKeys = {
  all: ['payment-ledger'] as const,
  lists: ['payment-ledger', 'list'] as const,
  list: (params: PaymentLedgerListParams) => ['payment-ledger', 'list', params] as const,
  summary: (params: PaymentLedgerFilterParams) => ['payment-ledger', 'summary', params] as const,
  detail: (id: number | undefined) => ['payment-ledger', 'detail', id] as const,
};

export function usePaymentLedgerList(params: PaymentLedgerListParams, enabled = true) {
  return useQuery({
    queryKey: paymentLedgerKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentLedgerEntry>>(`/api/payment/ledger/entries${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePaymentLedgerSummary(params: PaymentLedgerFilterParams, enabled = true) {
  return useQuery({
    queryKey: paymentLedgerKeys.summary(params),
    queryFn: () => request.get<PaymentLedgerSummary>(`/api/payment/ledger/summary${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}
