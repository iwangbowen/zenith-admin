import { memberFulfillmentContract } from '@zenith/shared/member';
import { useApiQuery } from '@/lib/contract-query';

export function useMemberWalletTransactionDetail(id: number | null) {
  return useApiQuery(memberFulfillmentContract.walletTransaction, { params: { id: id ?? 0 } }, { enabled: id !== null });
}
export function useMemberVipRenewalDetail(id: number | null) {
  return useApiQuery(memberFulfillmentContract.vipRenewal, { params: { id: id ?? 0 } }, { enabled: id !== null });
}
