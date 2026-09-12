import type { BodyOf } from '@zenith/shared/core';
import { paymentMethodContract } from '@zenith/shared/payment';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentMethodSaveValues = BodyOf<typeof paymentMethodContract.update>;

export const paymentMethodKeys = {
  lists: contractKey(paymentMethodContract.list),
  enabled: contractKey(paymentMethodContract.enabled),
  detail: (id: number | undefined) => contractKey(paymentMethodContract.detail, { params: { id: id ?? 0 } }),
};

export function usePaymentMethodList() {
  return useApiQuery(paymentMethodContract.list);
}

/** 可用支付方式（供下单选择），随配置启停变化 */
export function useEnabledPaymentMethods(enabled = true) {
  return useApiQuery(paymentMethodContract.enabled, { enabled });
}

export function usePaymentMethodDetail(id: number | undefined, enabled = true) {
  return useApiQuery(paymentMethodContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/**
 * 支付方式只允许编辑（启停 / 排序 / 名称 / 图标），变量即契约输入 `{ params: { id }, body }`；
 * 启停会改变可用支付方式列表，一并失效。
 */
export function useSavePaymentMethod() {
  return useApiMutation(paymentMethodContract.update, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.enabled });
      void qc.invalidateQueries({ queryKey: paymentMethodKeys.detail(saved.id) });
    },
  });
}
