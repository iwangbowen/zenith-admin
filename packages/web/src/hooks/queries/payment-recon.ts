import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentReconContract } from '@zenith/shared/payment';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { paymentJournalKeys, paymentLedgerAccountKeys } from './payment-journals';

export type PaymentReconBatchListParams = NonNullable<QueryOf<typeof paymentReconContract.list>>;
export type PaymentReconItemListParams = NonNullable<QueryOf<typeof paymentReconContract.items>>;
export type PaymentReconSampleBillParams = NonNullable<QueryOf<typeof paymentReconContract.sampleBill>>;

const resource = createResourceQueries(paymentReconContract);

export const paymentReconKeys = {
  ...resource.keys,
  items: contractKey(paymentReconContract.items),
  /** 某个批次的全部明细分页 / 筛选变体 */
  itemsOf: (batchId: number) => [...contractKey(paymentReconContract.items), { params: { id: batchId } }] as const,
  itemList: (batchId: number | undefined, params: PaymentReconItemListParams) =>
    contractKey(paymentReconContract.items, { params: { id: batchId ?? 0 }, query: params }),
};

/** 新批次（手动上传 / 自动拉取）只是列表多一行；批次详情与明细尚未被任何页面缓存 */
function invalidateBatchLists(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentReconKeys.lists });
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

/** 模拟账单是按需生成的文本，不进入缓存；变量即契约输入 `{ query }` */
export function usePaymentReconSampleBill() {
  return useApiMutation(paymentReconContract.sampleBill);
}

export function useCreatePaymentReconBatch() {
  return useApiMutation(paymentReconContract.create, { invalidate: invalidateBatchLists });
}

export function useAutoPaymentRecon() {
  return useApiMutation(paymentReconContract.auto, { invalidate: invalidateBatchLists });
}

/** 批次已删除：详情与明细缓存移除而非失效，列表回源 */
export function useDeletePaymentReconBatch() {
  return useApiMutation(paymentReconContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: paymentReconKeys.detail(params.id) });
      qc.removeQueries({ queryKey: paymentReconKeys.itemsOf(params.id) });
      invalidateBatchLists(qc);
    },
  });
}

/**
 * 处理差异改写该明细的 handleStatus，并改变所属批次的已处理 / 待处理计数（列表与详情都渲染）；
 * 「已调账」还会原子写入一笔双分录凭证，资金凭证列表与账户余额一并回源。
 */
export function useHandlePaymentReconItem() {
  return useApiMutation(paymentReconContract.handleItem, {
    invalidate: (qc, item) => {
      void qc.invalidateQueries({ queryKey: paymentReconKeys.itemsOf(item.batchId) });
      void qc.invalidateQueries({ queryKey: paymentReconKeys.detail(item.batchId) });
      void qc.invalidateQueries({ queryKey: paymentReconKeys.lists });
      if (item.handleStatus === 'adjusted') {
        void qc.invalidateQueries({ queryKey: paymentJournalKeys.lists });
        void qc.invalidateQueries({ queryKey: paymentLedgerAccountKeys.lists });
      }
    },
  });
}
