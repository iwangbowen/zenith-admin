import type { QueryOf } from '@zenith/shared/core';
import { paymentNotifyLogContract } from '@zenith/shared/payment';
import { keepPreviousData } from '@tanstack/react-query';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type PaymentLogListParams = NonNullable<QueryOf<typeof paymentNotifyLogContract.logs>>;

export const paymentLogKeys = {
  lists: contractKey(paymentNotifyLogContract.logs),
  list: (params: PaymentLogListParams) => contractKey(paymentNotifyLogContract.logs, { query: params }),
};

export function usePaymentLogList(params: PaymentLogListParams) {
  return useApiQuery(paymentNotifyLogContract.logs, { query: params }, { placeholderData: keepPreviousData });
}
