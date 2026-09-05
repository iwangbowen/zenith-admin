import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentPreauthContract } from '@zenith/shared/payment';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type PaymentPreauthListParams = NonNullable<QueryOf<typeof paymentPreauthContract.list>>;

const resource = createResourceQueries(paymentPreauthContract);

export const paymentPreauthKeys = resource.keys;
export const usePaymentPreauthList = resource.useList;

/** 预授权单没有详情端点，任何资金操作只需回源列表 */
function invalidatePreauthLists(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentPreauthKeys.lists });
}

export function useCreatePaymentPreauth() {
  return useApiMutation(paymentPreauthContract.create, { invalidate: invalidatePreauthLists });
}

export function useCapturePaymentPreauth() {
  return useApiMutation(paymentPreauthContract.capture, { invalidate: invalidatePreauthLists });
}

export function useReleasePaymentPreauth() {
  return useApiMutation(paymentPreauthContract.release, { invalidate: invalidatePreauthLists });
}

export function useRecoverPaymentPreauth() {
  return useApiMutation(paymentPreauthContract.recover, { invalidate: invalidatePreauthLists });
}
