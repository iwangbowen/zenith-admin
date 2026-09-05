import type { QueryOf } from '@zenith/shared/core';
import { paymentAppContract } from '@zenith/shared/payment';
import { createResourceQueries } from '@/lib/contract-query';

export type PaymentAppListParams = NonNullable<QueryOf<typeof paymentAppContract.list>>;

export const {
  keys: paymentAppKeys,
  useList: usePaymentAppList,
  useDetail: usePaymentAppDetail,
  useSave: useSavePaymentApp,
  /** 服务端未提供 DELETE /batch，多选删除按单条并发执行 */
  useDelete: useDeletePaymentApp,
} = createResourceQueries(paymentAppContract);
