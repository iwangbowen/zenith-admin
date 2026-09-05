import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { paymentSharingContract, type PaymentSharingReceiver } from '@zenith/shared/payment';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type PaymentSharingReceiverListParams = NonNullable<QueryOf<typeof paymentSharingContract.receivers>>;
export type PaymentSharingOrderListParams = NonNullable<QueryOf<typeof paymentSharingContract.orders>>;
export type PaymentSharingReversalListParams = NonNullable<QueryOf<typeof paymentSharingContract.reversals>>;
export type PaymentSharingReceiverSaveValues = Partial<BodyOf<typeof paymentSharingContract.createReceiver>>;

/** 分账方 / 分账单 / 冲正共用 `/api/payment/sharing` 根，key 按操作名区分 */
export const paymentSharingKeys = {
  receiverLists: contractKey(paymentSharingContract.receivers),
  receiverList: (params: PaymentSharingReceiverListParams) => contractKey(paymentSharingContract.receivers, { query: params }),
  receiverDetails: contractKey(paymentSharingContract.receiverDetail),
  receiverDetail: (id: number | undefined) => contractKey(paymentSharingContract.receiverDetail, { params: { id: id ?? 0 } }),
  /** 启用中的分账方下拉源（发起分账弹窗） */
  enabledReceivers: [...contractKey(paymentSharingContract.receivers), 'enabled'] as const,
  orderLists: contractKey(paymentSharingContract.orders),
  orderList: (params: PaymentSharingOrderListParams) => contractKey(paymentSharingContract.orders, { query: params }),
  reversalLists: contractKey(paymentSharingContract.reversals),
  reversalList: (params: PaymentSharingReversalListParams) => contractKey(paymentSharingContract.reversals, { query: params }),
  reversalDetails: contractKey(paymentSharingContract.reversalDetail),
  reversalDetail: (id: number | undefined) => contractKey(paymentSharingContract.reversalDetail, { params: { id: id ?? 0 } }),
};

/** 分账方增删改：列表、详情与启用中下拉源一并回源；分账单不受影响 */
function invalidateReceivers(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.receiverLists });
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.receiverDetails });
  void qc.invalidateQueries({ queryKey: paymentSharingKeys.enabledReceivers });
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
  const qc = useQueryClient();
  return useMutation<PaymentSharingReceiver, Error, { id?: number; values: PaymentSharingReceiverSaveValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(paymentSharingContract.createReceiver, { body: values as BodyOf<typeof paymentSharingContract.createReceiver> })
        : api(paymentSharingContract.updateReceiver, { params: { id }, body: values }),
    onSuccess: () => invalidateReceivers(qc),
  });
}

/** 服务端未提供 DELETE /batch，多选删除按单条并发执行 */
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
  return useQuery({
    queryKey: paymentSharingKeys.reversalDetail(id),
    queryFn: () => api(paymentSharingContract.reversalDetail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

/** 启用中的分账方下拉源：取列表首页 100 条启用项 */
export function useEnabledPaymentSharingReceivers(enabled = true) {
  return useQuery({
    queryKey: paymentSharingKeys.enabledReceivers,
    queryFn: () =>
      api(paymentSharingContract.receivers, { query: { page: 1, pageSize: 100, status: 'enabled' } })
        .then((data) => data.list.filter((r) => r.status === 'enabled')),
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
