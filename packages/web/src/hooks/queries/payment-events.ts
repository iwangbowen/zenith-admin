import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentOpsContract } from '@zenith/shared/payment';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentEventListParams = NonNullable<QueryOf<typeof paymentOpsContract.events>>;

export const paymentEventKeys = {
  lists: contractKey(paymentOpsContract.events),
  list: (params: PaymentEventListParams) => contractKey(paymentOpsContract.events, { query: params }),
  attempts: (id: number | undefined) => contractKey(paymentOpsContract.eventAttempts, { params: { id: id ?? 0 } }),
  health: contractKey(paymentOpsContract.health),
};

export function usePaymentEventList(params: PaymentEventListParams) {
  return useApiQuery(paymentOpsContract.events, { query: params }, { placeholderData: keepPreviousData });
}

export function usePaymentEventAttempts(id: number | undefined, enabled = true) {
  return useApiQuery(paymentOpsContract.eventAttempts, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 重试改变单个消费者状态与公共 Outbox 积压指标 */
export function useRedispatchPaymentEvent() {
  return useApiMutation(paymentOpsContract.redispatchEvent, {
    invalidate: (qc, _event, variables) => {
      void qc.invalidateQueries({ queryKey: paymentEventKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentEventKeys.attempts(variables.params.id) });
      void qc.invalidateQueries({ queryKey: paymentEventKeys.health });
    },
  });
}

export function usePaymentOpsHealth(enabled = true) {
  return useApiQuery(paymentOpsContract.health, { refetchInterval: 30000, enabled });
}
