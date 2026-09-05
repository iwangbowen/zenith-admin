import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentOpsContract, paymentOrderContract, paymentRefundContract } from '@zenith/shared/payment';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidatePaymentRefunds, paymentRefundKeys } from './payment-refunds';
import { paymentStatsKeys } from './payment-stats';

export type PaymentOrderListParams = NonNullable<QueryOf<typeof paymentOrderContract.orders>>;

/** 订单与商户配置 / 退款共用 `/api/payment` 根，key 按操作名区分 */
export const paymentOrderKeys = {
  lists: contractKey(paymentOrderContract.orders),
  list: (params: PaymentOrderListParams) => contractKey(paymentOrderContract.orders, { query: params }),
  details: contractKey(paymentOrderContract.orderDetail),
  detail: (id: number | undefined) => contractKey(paymentOrderContract.orderDetail, { params: { id: id ?? 0 } }),
  byNos: contractKey(paymentOrderContract.orderByNo),
  byNo: (orderNo: string | undefined) => contractKey(paymentOrderContract.orderByNo, { params: { orderNo: orderNo ?? '' } }),
  refunds: paymentRefundKeys.byOrder,
};

/** 订单状态变化影响列表、详情、按单号查询与统计概览 / 趋势 */
export function invalidatePaymentOrders(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentOrderKeys.lists });
  void qc.invalidateQueries({ queryKey: paymentOrderKeys.details });
  void qc.invalidateQueries({ queryKey: paymentOrderKeys.byNos });
  void qc.invalidateQueries({ queryKey: paymentStatsKeys.stats });
  void qc.invalidateQueries({ queryKey: paymentStatsKeys.trends });
}

export function usePaymentOrderList(params: PaymentOrderListParams) {
  return useApiQuery(paymentOrderContract.orders, { query: params }, { placeholderData: keepPreviousData });
}

export function usePaymentOrderDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentOrderKeys.detail(id),
    queryFn: () => api(paymentOrderContract.orderDetail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function usePaymentOrderByNo(orderNo: string | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentOrderKeys.byNo(orderNo),
    queryFn: () => api(paymentOrderContract.orderByNo, { params: { orderNo: orderNo ?? '' } }),
    enabled: enabled && !!orderNo,
    // 终态（成功/关闭/退款/失败）自动停止轮询，避免弹窗未及时关闭时空转
    refetchInterval: (query) => {
      if (!enabled || !orderNo) return false;
      const s = query.state.data?.status;
      if (s === 'success' || s === 'closed' || s === 'refunded' || s === 'failed') return false;
      return 3000;
    },
  });
}

export function usePaymentOrderRefunds(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentRefundKeys.byOrder(id),
    queryFn: () => api(paymentRefundContract.orderRefunds, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

export function useCreatePaymentOrder() {
  return useApiMutation(paymentOrderContract.createOrder, { invalidate: invalidatePaymentOrders });
}

export function useQueryPaymentOrder() {
  return useApiMutation(paymentOrderContract.queryOrder, { invalidate: invalidatePaymentOrders });
}

/** 模拟支付走运营域端点，但改变的是订单状态与统计 */
export function useSimulatePaymentOrderPaid() {
  return useApiMutation(paymentOpsContract.simulateOrderPaid, { invalidate: invalidatePaymentOrders });
}

export function useClosePaymentOrder() {
  return useApiMutation(paymentOrderContract.closeOrder, { invalidate: invalidatePaymentOrders });
}

/** 发起退款：订单进入退款中 / 已退款，退款列表与统计随之变化；幂等键由页面按业务意图生成，放在输入的 headers 段 */
export function useCreatePaymentRefund() {
  return useApiMutation(paymentRefundContract.createRefund, {
    invalidate: (qc) => {
      invalidatePaymentOrders(qc);
      invalidatePaymentRefunds(qc);
    },
  });
}
