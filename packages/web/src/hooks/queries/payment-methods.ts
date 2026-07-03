import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentMethodConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const paymentMethodKeys = {
  all: ['payment-methods'] as const,
  lists: ['payment-methods', 'list'] as const,
  list: () => ['payment-methods', 'list'] as const,
  detail: (id: number | undefined) => ['payment-methods', 'detail', id] as const,
};

export function usePaymentMethodList() {
  return useQuery({
    queryKey: paymentMethodKeys.list(),
    queryFn: () => request.get<PaymentMethodConfig[]>('/api/payment/methods').then(unwrap),
  });
}

export function usePaymentMethodDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentMethodKeys.detail(id),
    queryFn: () => request.get<PaymentMethodConfig>(`/api/payment/methods/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSavePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<PaymentMethodConfig> }) =>
      request.put<PaymentMethodConfig>(`/api/payment/methods/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentMethodKeys.all }),
  });
}
