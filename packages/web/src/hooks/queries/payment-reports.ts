import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentReportContract } from '@zenith/shared/payment';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type PaymentReportSummaryParams = NonNullable<QueryOf<typeof paymentReportContract.summary>>;

export const paymentReportKeys = {
  lists: contractKey(paymentReportContract.summary),
  list: (params: PaymentReportSummaryParams) => contractKey(paymentReportContract.summary, { query: params }),
};

export function usePaymentReportSummary(params: PaymentReportSummaryParams, enabled = true) {
  return useApiQuery(paymentReportContract.summary, { query: params }, { placeholderData: keepPreviousData, enabled });
}
