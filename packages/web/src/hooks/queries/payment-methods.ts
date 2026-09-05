import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { paymentMethodContract, type PaymentMethodConfig } from '@zenith/shared/payment';
import { api, contractKey } from '@/lib/contract-query';

export type PaymentMethodSaveValues = BodyOf<typeof paymentMethodContract.update>;

export const paymentMethodKeys = {
  lists: contractKey(paymentMethodContract.list),
  enabled: contractKey(paymentMethodContract.enabled),
  detail: (id: number | undefined) => contractKey(paymentMethodContract.detail, { params: { id: id ?? 0 } }),
};

export function usePaymentMethodList() {
  return useQuery({
    queryKey: paymentMethodKeys.lists,
    queryFn: () => api(paymentMethodContract.list),
  });
}

/** 可用支付方式（供下单选择），随配置启停变化 */
export function useEnabledPaymentMethods(enabled = true) {
  return useQuery({
    queryKey: paymentMethodKeys.enabled,
    queryFn: () => api(paymentMethodContract.enabled),
    enabled,
  });
}

export function usePaymentMethodDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentMethodKeys.detail(id),
    queryFn: () => api(paymentMethodContract.detail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

/** 支付方式只允许编辑（启停 / 排序 / 名称 / 图标）；启停会改变可用支付方式列表，一并失效 */
export function useSavePaymentMethod() {
  const qc = useQueryClient();
  return useMutation<PaymentMethodConfig, Error, { id: number; values: PaymentMethodSaveValues }>({
    mutationFn: ({ id, values }) => api(paymentMethodContract.update, { params: { id }, body: values }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.enabled });
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.detail(saved.id) });
    },
  });
}
