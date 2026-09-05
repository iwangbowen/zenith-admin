import type { QueryOf } from '@zenith/shared/core';
import { paymentFeeRuleContract } from '@zenith/shared/payment';
import { createResourceQueries } from '@/lib/contract-query';

export type PaymentFeeRuleListParams = NonNullable<QueryOf<typeof paymentFeeRuleContract.list>>;

export const {
  keys: paymentFeeKeys,
  useList: usePaymentFeeRuleList,
  useDetail: usePaymentFeeRuleDetail,
  useSave: useSavePaymentFeeRule,
  /** 契约无批量删除操作，多选删除按单条并发执行 */
  useDelete: useDeletePaymentFeeRule,
} = createResourceQueries(paymentFeeRuleContract);
