import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentDisputeContract } from '@zenith/shared/payment';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentDisputeListParams = NonNullable<QueryOf<typeof paymentDisputeContract.list>>;

const resource = createResourceQueries(paymentDisputeContract);

export const paymentDisputeKeys = {
  ...resource.keys,
  details: [...resource.keys.all, 'detail'] as const,
  stats: contractKey(paymentDisputeContract.stats),
};

/** 工单状态变化影响列表、详情与统计卡（待处理 / 超时数） */
function invalidateDisputes(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentDisputeKeys.lists });
  void qc.invalidateQueries({ queryKey: paymentDisputeKeys.details });
  void qc.invalidateQueries({ queryKey: paymentDisputeKeys.stats });
}

export const usePaymentDisputeList = resource.useList;
export const usePaymentDisputeDetail = resource.useDetail;

export function usePaymentDisputeStats() {
  return useApiQuery(paymentDisputeContract.stats);
}

export function useReplyPaymentDispute() {
  return useApiMutation(paymentDisputeContract.reply, { invalidate: invalidateDisputes });
}

export function useResolvePaymentDispute() {
  return useApiMutation(paymentDisputeContract.resolve, { invalidate: invalidateDisputes });
}

export function useRefundPaymentDispute() {
  return useApiMutation(paymentDisputeContract.refund, { invalidate: invalidateDisputes });
}

export function useSimulatePaymentDispute() {
  return useApiMutation(paymentDisputeContract.simulate, { invalidate: invalidateDisputes });
}
