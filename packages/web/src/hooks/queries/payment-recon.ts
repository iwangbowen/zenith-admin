import { keepPreviousData, useMutation, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentReconContract } from '@zenith/shared/payment';
import { api, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentReconBatchListParams = NonNullable<QueryOf<typeof paymentReconContract.list>>;
export type PaymentReconItemListParams = NonNullable<QueryOf<typeof paymentReconContract.items>>;
export type PaymentReconSampleBillParams = NonNullable<QueryOf<typeof paymentReconContract.sampleBill>>;

const resource = createResourceQueries(paymentReconContract);

export const paymentReconKeys = {
  ...resource.keys,
  items: contractKey(paymentReconContract.items),
  itemList: (batchId: number | undefined, params: PaymentReconItemListParams) =>
    contractKey(paymentReconContract.items, { params: { id: batchId ?? 0 }, query: params }),
};

/** 对账批次的增删与差异处理都会改变批次统计（matched / diff 计数）与明细 */
function invalidateRecon(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentReconKeys.all });
}

export const usePaymentReconBatchList = resource.useList;
export const usePaymentReconBatchDetail = resource.useDetail;

export function usePaymentReconItems(batchId: number | undefined, params: PaymentReconItemListParams, enabled = true) {
  return useApiQuery(
    paymentReconContract.items,
    { params: { id: batchId ?? 0 }, query: params },
    { placeholderData: keepPreviousData, enabled: enabled && batchId !== undefined },
  );
}

/** 模拟账单是按需生成的文本，不进入缓存 */
export function usePaymentReconSampleBill() {
  return useMutation({
    mutationFn: (params: PaymentReconSampleBillParams) => api(paymentReconContract.sampleBill, { query: params }),
  });
}

export function useCreatePaymentReconBatch() {
  return useApiMutation(paymentReconContract.create, { invalidate: invalidateRecon });
}

export function useAutoPaymentRecon() {
  return useApiMutation(paymentReconContract.auto, { invalidate: invalidateRecon });
}

export function useDeletePaymentReconBatch() {
  return useApiMutation(paymentReconContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: paymentReconKeys.detail(params.id) });
      invalidateRecon(qc);
    },
  });
}

export function useHandlePaymentReconItem() {
  return useApiMutation(paymentReconContract.handleItem, { invalidate: invalidateRecon });
}
