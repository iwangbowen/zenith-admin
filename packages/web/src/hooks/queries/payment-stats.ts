import { useQuery } from '@tanstack/react-query';
import type { PaymentStats, PaymentTrendPoint } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export const paymentStatsKeys = {
  all: ['payment-stats'] as const,
  stats: () => ['payment-stats', 'stats'] as const,
  trend: (days: number) => ['payment-stats', 'trend', { days }] as const,
};

export function usePaymentStats() {
  return useQuery({
    queryKey: paymentStatsKeys.stats(),
    queryFn: () => request.get<PaymentStats>('/api/payment/stats').then(unwrap),
  });
}

export function usePaymentTrend(days: number) {
  return useQuery({
    queryKey: paymentStatsKeys.trend(days),
    queryFn: () => request.get<PaymentTrendPoint[]>(`/api/payment/trend${toQueryString({ days })}`).then(unwrap),
  });
}
