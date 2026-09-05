import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentRefundContract } from '@zenith/shared/payment';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentRefundListParams = NonNullable<QueryOf<typeof paymentRefundContract.refunds>>;

/** 退款与订单 / 商户配置共用 `/api/payment` 根，key 按操作名区分 */
export const paymentRefundKeys = {
  lists: contractKey(paymentRefundContract.refunds),
  list: (params: PaymentRefundListParams) => contractKey(paymentRefundContract.refunds, { query: params }),
  details: contractKey(paymentRefundContract.refundDetail),
  detail: (id: number | undefined) => contractKey(paymentRefundContract.refundDetail, { params: { id: id ?? 0 } }),
  /** 订单关联退款（订单详情弹窗） */
  byOrders: contractKey(paymentRefundContract.orderRefunds),
  byOrder: (orderId: number | undefined) => contractKey(paymentRefundContract.orderRefunds, { params: { id: orderId ?? 0 } }),
};

/** 退款状态变化影响退款列表、详情与订单关联退款三处 */
export function invalidatePaymentRefunds(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentRefundKeys.lists });
  void qc.invalidateQueries({ queryKey: paymentRefundKeys.details });
  void qc.invalidateQueries({ queryKey: paymentRefundKeys.byOrders });
}

export function usePaymentRefundList(params: PaymentRefundListParams) {
  return useApiQuery(paymentRefundContract.refunds, { query: params }, { placeholderData: keepPreviousData });
}

export function usePaymentRefundDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentRefundKeys.detail(id),
    queryFn: () => api(paymentRefundContract.refundDetail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function useQueryPaymentRefund() {
  return useApiMutation(paymentRefundContract.queryRefund, { invalidate: invalidatePaymentRefunds });
}

export function useApprovePaymentRefund() {
  return useApiMutation(paymentRefundContract.approveRefund, { invalidate: invalidatePaymentRefunds });
}

export function useRejectPaymentRefund() {
  return useApiMutation(paymentRefundContract.rejectRefund, { invalidate: invalidatePaymentRefunds });
}
