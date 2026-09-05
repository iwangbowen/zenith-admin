import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentSettlementContract } from '@zenith/shared/payment';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentSettlementListParams = NonNullable<QueryOf<typeof paymentSettlementContract.list>>;

const resource = createResourceQueries(paymentSettlementContract);

export const paymentSettlementKeys = {
  ...resource.keys,
  itemLists: contractKey(paymentSettlementContract.items),
  items: (id: number | undefined) => contractKey(paymentSettlementContract.items, { params: { id: id ?? 0 } }),
};

/** 批次状态流转 / 生成 / 删除都会改变列表与详情 */
function invalidateSettlements(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentSettlementKeys.lists });
  void qc.invalidateQueries({ queryKey: [...paymentSettlementKeys.all, 'detail'] });
}

export const usePaymentSettlementList = resource.useList;
export const usePaymentSettlementDetail = resource.useDetail;

export function usePaymentSettlementItems(id: number | undefined, enabled = true) {
  return useApiQuery(paymentSettlementContract.items, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useGeneratePaymentSettlement() {
  return useApiMutation(paymentSettlementContract.generate, { invalidate: invalidateSettlements });
}

export function useUpdatePaymentSettlementStatus() {
  return useApiMutation(paymentSettlementContract.transition, { invalidate: invalidateSettlements });
}

export function useDeletePaymentSettlement() {
  return useApiMutation(paymentSettlementContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: paymentSettlementKeys.detail(params.id) });
      qc.removeQueries({ queryKey: paymentSettlementKeys.items(params.id) });
      invalidateSettlements(qc);
    },
  });
}
