import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentOpsContract } from '@zenith/shared/payment';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentEventListParams = NonNullable<QueryOf<typeof paymentOpsContract.events>>;

export const paymentEventKeys = {
  lists: contractKey(paymentOpsContract.events),
  list: (params: PaymentEventListParams) => contractKey(paymentOpsContract.events, { query: params }),
  health: contractKey(paymentOpsContract.health),
};

export function usePaymentEventList(params: PaymentEventListParams) {
  return useApiQuery(paymentOpsContract.events, { query: params }, { placeholderData: keepPreviousData });
}

/** 重投改变事件状态与 outbox 积压指标 */
export function useRedispatchPaymentEvent() {
  return useApiMutation(paymentOpsContract.redispatchEvent, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: paymentEventKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentEventKeys.health });
    },
  });
}

export function usePaymentOpsHealth(enabled = true) {
  return useApiQuery(paymentOpsContract.health, { refetchInterval: 30000, enabled });
}
