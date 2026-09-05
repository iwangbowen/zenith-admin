import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentTransferContract } from '@zenith/shared/payment';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentTransferListParams = NonNullable<QueryOf<typeof paymentTransferContract.list>>;

const resource = createResourceQueries(paymentTransferContract);

export const paymentTransferKeys = {
  ...resource.keys,
  summaries: contractKey(paymentTransferContract.summary),
};

/** 转账状态变化同时改变列表、汇总卡与该单详情 */
function invalidateTransfer(qc: QueryClient, id?: number) {
  void qc.invalidateQueries({ queryKey: paymentTransferKeys.lists });
  void qc.invalidateQueries({ queryKey: paymentTransferKeys.summaries });
  if (id !== undefined) void qc.invalidateQueries({ queryKey: paymentTransferKeys.detail(id) });
}

export const usePaymentTransferList = resource.useList;
export const usePaymentTransferDetail = resource.useDetail;

export function usePaymentTransferSummary(enabled = true) {
  return useApiQuery(paymentTransferContract.summary, { query: {} }, { enabled });
}

/** 发起转账：幂等键由页面按业务意图生成，放在输入的 headers 段 */
export function useCreatePaymentTransfer() {
  return useApiMutation(paymentTransferContract.create, {
    invalidate: (qc) => invalidateTransfer(qc),
  });
}

export function useQueryPaymentTransfer() {
  return useApiMutation(paymentTransferContract.query, {
    invalidate: (qc, transfer) => invalidateTransfer(qc, transfer.id),
  });
}

export function useApprovePaymentTransfer() {
  return useApiMutation(paymentTransferContract.approve, {
    invalidate: (qc, transfer) => invalidateTransfer(qc, transfer.id),
  });
}

export function useRejectPaymentTransfer() {
  return useApiMutation(paymentTransferContract.reject, {
    invalidate: (qc, transfer) => invalidateTransfer(qc, transfer.id),
  });
}
