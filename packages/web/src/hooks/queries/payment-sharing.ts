import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { paymentSharingContract } from '@zenith/shared/payment';
import { api, useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type PaymentSharingReceiverListParams = NonNullable<QueryOf<typeof paymentSharingContract.receivers>>;
export type PaymentSharingOrderListParams = NonNullable<QueryOf<typeof paymentSharingContract.orders>>;
export type PaymentSharingReversalListParams = NonNullable<QueryOf<typeof paymentSharingContract.reversals>>;
export type PaymentSharingReceiverSaveValues = Partial<BodyOf<typeof paymentSharingContract.createReceiver>>;

/** 启用中的分账方下拉源取列表首页 100 条启用项：与分账方列表同一操作，只是固定了查询参数 */
const ENABLED_RECEIVERS_QUERY: PaymentSharingReceiverListParams = { page: 1, pageSize: 100, status: 'enabled' };

/** 分账方 / 分账单 / 冲正共用分账资源根，key 按操作名区分 */
export const paymentSharingKeys = {
  receiverLists: contractKey(paymentSharingContract.receivers),
  receiverList: (params: PaymentSharingReceiverListParams) => contractKey(paymentSharingContract.receivers, { query: params }),
  receiverDetails: contractKey(paymentSharingContract.receiverDetail),
  receiverDetail: (id: number | undefined) => contractKey(paymentSharingContract.receiverDetail, { params: { id: id ?? 0 } }),
  /** 启用中的分账方下拉源（发起分账弹窗）：位于 receiverLists 前缀之下，随分账方增删改一并回源 */
  enabledReceivers: contractKey(paymentSharingContract.receivers, { query: ENABLED_RECEIVERS_QUERY }),
  orderLists: contractKey(paymentSharingContract.orders),
  orderList: (params: PaymentSharingOrderListParams) => contractKey(paymentSharingContract.orders, { query: params }),
  reversalLists: contractKey(paymentSharingContract.reversals),
  reversalList: (params: PaymentSharingReversalListParams) => contractKey(paymentSharingContract.reversals, { query: params }),
  reversalDetails: contractKey(paymentSharingContract.reversalDetail),
  reversalDetail: (id: number | undefined) => contractKey(paymentSharingContract.reversalDetail, { params: { id: id ?? 0 } }),
};

/** 分账方增删改：列表（含启用中下拉源，同前缀）与详情一并回源；分账单不受影响 */
function invalidateReceivers(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.receiverLists });
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.receiverDetails });
}

/** 分账 / 冲正改变分账单与冲正记录两份列表 */
function invalidateSharingOrders(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.orderLists });
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.reversalLists });
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.reversalDetails });
}

export function usePaymentSharingReceivers(params: PaymentSharingReceiverListParams, enabled = true) {
  return useApiQuery(paymentSharingContract.receivers, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 无 id 走新增，有 id 走更新 */
export function useSavePaymentSharingReceiver() {
  return useSaveMutation(paymentSharingContract.createReceiver, paymentSharingContract.updateReceiver, {
    invalidate: (qc) => invalidateReceivers(qc),
  });
}

/** H5 保留：契约无批量删除操作，多选删除按单条并发执行（mutationFn 组合多次请求） */
export function useDeletePaymentSharingReceivers() {
  const qc = useQueryClient();
  return useMutation<null, Error, number[]>({
    mutationFn: async (ids) => {
      await Promise.all(ids.map((id) => api(paymentSharingContract.removeReceiver, { params: { id } })));
      return null;
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) qc.removeQueries({ queryKey: paymentSharingKeys.receiverDetail(id) });
      invalidateReceivers(qc);
    },
  });
}

export function usePaymentSharingOrders(params: PaymentSharingOrderListParams) {
  return useApiQuery(paymentSharingContract.orders, { query: params }, { placeholderData: keepPreviousData });
}

export function usePaymentSharingReversals(params: PaymentSharingReversalListParams) {
  return useApiQuery(paymentSharingContract.reversals, { query: params }, { placeholderData: keepPreviousData });
}

export function usePaymentSharingReversalDetail(id: number | undefined, enabled = true) {
  return useApiQuery(paymentSharingContract.reversalDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 启用中的分账方下拉源：与分账方列表共用缓存条目，只在 select 里投影为启用项数组 */
export function useEnabledPaymentSharingReceivers(enabled = true) {
  return useApiQuery(paymentSharingContract.receivers, { query: ENABLED_RECEIVERS_QUERY }, {
    select: (data) => data.list.filter((r) => r.status === 'enabled'),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

/** 新增分账单不改变分账方名单，故不碰 receiverLists 与 enabledReceivers */
export function useCreatePaymentSharingOrder() {
  return useApiMutation(paymentSharingContract.dispatch, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: paymentSharingKeys.orderLists }),
  });
}

/** 发起冲正：幂等键由页面按业务意图生成，放在输入的 headers 段 */
export function useReversePaymentSharingOrder() {
  return useApiMutation(paymentSharingContract.reverse, { invalidate: invalidateSharingOrders });
}

export function useQueryPaymentSharingReversal() {
  return useApiMutation(paymentSharingContract.queryReversal, { invalidate: invalidateSharingOrders });
}
