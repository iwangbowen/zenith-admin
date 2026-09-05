import { paymentStatsContract } from '@zenith/shared/payment';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const paymentStatsKeys = {
  stats: contractKey(paymentStatsContract.stats),
  trends: contractKey(paymentStatsContract.trend),
  trend: (days: number) => contractKey(paymentStatsContract.trend, { query: { days } }),
};

export function usePaymentStats() {
  return useApiQuery(paymentStatsContract.stats);
}

export function usePaymentTrend(days: number) {
  return useApiQuery(paymentStatsContract.trend, { query: { days } });
}
