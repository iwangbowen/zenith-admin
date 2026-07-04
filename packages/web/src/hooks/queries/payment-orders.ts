import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePaymentResult, PaginatedResponse, PaymentOrder, PaymentRefund } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { paymentRefundKeys } from './payment-refunds';
import { paymentStatsKeys } from './payment-stats';

export interface PaymentOrderListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  channel?: string;
  status?: string;
  payMethod?: string;
  bizType?: string;
  minAmount?: number;
  maxAmount?: number;
  startTime?: string;
  endTime?: string;
}

export interface CreatePaymentOrderValues {
  bizType: string;
  bizId: string;
  subject: string;
  amount: number;
  payMethod: string;
  openId?: string;
}

export interface CreateRefundValues {
  orderNo: string;
  refundAmount: number;
  reason?: string;
}

export const paymentOrderKeys = {
  all: ['payment-orders'] as const,
  lists: ['payment-orders', 'list'] as const,
  list: (params: PaymentOrderListParams) => ['payment-orders', 'list', params] as const,
  detail: (id: number | undefined) => ['payment-orders', 'detail', id] as const,
  byNo: (orderNo: string | undefined) => ['payment-orders', 'by-no', orderNo] as const,
  refunds: (id: number | undefined) => ['payment-orders', 'refunds', id] as const,
};

export function usePaymentOrderList(params: PaymentOrderListParams) {
  return useQuery({
    queryKey: paymentOrderKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<PaymentOrder>>(`/api/payment/orders${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentOrderDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentOrderKeys.detail(id),
    queryFn: () => request.get<PaymentOrder>(`/api/payment/orders/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function usePaymentOrderByNo(orderNo: string | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentOrderKeys.byNo(orderNo),
    queryFn: () => request.get<PaymentOrder>(`/api/payment/orders/by-no/${encodeURIComponent(orderNo ?? '')}`).then(unwrap),
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
    queryKey: paymentOrderKeys.refunds(id),
    queryFn: () => request.get<PaymentRefund[]>(`/api/payment/orders/${id}/refunds`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useCreatePaymentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CreatePaymentOrderValues) =>
      request.post<{ orderNo: string; payParams: CreatePaymentResult }>('/api/payment/orders', values).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentOrderKeys.all });
      void qc.invalidateQueries({ queryKey: paymentStatsKeys.all });
    },
  });
}

export function useQueryPaymentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentOrder>(`/api/payment/orders/${id}/query`).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentOrderKeys.all });
      void qc.invalidateQueries({ queryKey: paymentStatsKeys.all });
    },
  });
}

export function useSimulatePaymentOrderPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<PaymentOrder>(`/api/payment/ops/orders/${id}/simulate-paid`, {}).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentOrderKeys.all });
      void qc.invalidateQueries({ queryKey: paymentStatsKeys.all });
    },
  });
}

export function useClosePaymentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/payment/orders/${id}/close`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentOrderKeys.all }),
  });
}

export function useCreatePaymentRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateRefundValues) => request.post<PaymentRefund>('/api/payment/refunds', values).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentOrderKeys.all });
      void qc.invalidateQueries({ queryKey: paymentRefundKeys.all });
      void qc.invalidateQueries({ queryKey: paymentStatsKeys.all });
    },
  });
}
