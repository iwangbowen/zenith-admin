import type { QueryOf } from '@zenith/shared/core';
import { paymentCapabilityContract } from '@zenith/shared/payment';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type PaymentCapabilityParams = NonNullable<QueryOf<typeof paymentCapabilityContract.list>>;

export const paymentCapabilityKeys = {
  all: contractKey(paymentCapabilityContract.list),
  list: (params: PaymentCapabilityParams) => contractKey(paymentCapabilityContract.list, { query: params }),
};

/** 渠道有效能力：由商户配置 × 运行模式 × 支付方式启停派生，配置变更后由各自域失效，这里只做短期缓存 */
export function usePaymentCapabilities(params: PaymentCapabilityParams, enabled = true) {
  return useApiQuery(paymentCapabilityContract.list, { query: params }, { enabled, staleTime: 60_000 });
}
