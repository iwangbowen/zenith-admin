import type { QueryOf } from '@zenith/shared/core';
import { paymentFeeRuleContract } from '@zenith/shared/payment';
import { createResourceQueries } from '@/lib/contract-query';

export type PaymentFeeRuleListParams = NonNullable<QueryOf<typeof paymentFeeRuleContract.list>>;

export const {
  keys: paymentFeeKeys,
  useList: usePaymentFeeRuleList,
  useDetail: usePaymentFeeRuleDetail,
  useSave: useSavePaymentFeeRule,
  /** 服务端未提供 DELETE /batch，多选删除按单条并发执行 */
  useDelete: useDeletePaymentFeeRule,
} = createResourceQueries(paymentFeeRuleContract);
