import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaymentReportGroupBy, PaymentReportRow } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface PaymentReportTotals {
  totalGross: number;
  totalFee: number;
  totalRefund: number;
  totalNet: number;
  totalCount: number;
}

export interface PaymentReportSummary extends PaymentReportTotals {
  groupBy: PaymentReportGroupBy;
  rows: PaymentReportRow[];
  /** 环比周期汇总（compare=true 且提供时间范围时返回） */
  prev?: PaymentReportTotals | null;
}

export interface PaymentReportSummaryParams {
  groupBy: PaymentReportGroupBy;
  startTime?: string;
  endTime?: string;
  compare?: 'true';
}

export const paymentReportKeys = {
  all: ['payment-reports'] as const,
  lists: ['payment-reports', 'list'] as const,
  list: (params: PaymentReportSummaryParams) => ['payment-reports', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-reports', 'detail', id] as const,
};

export function usePaymentReportSummary(params: PaymentReportSummaryParams, enabled = true) {
  return useQuery({
    queryKey: paymentReportKeys.list(params),
    queryFn: () => request.get<PaymentReportSummary>(`/api/payment/reports/summary${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled,
  });
}
