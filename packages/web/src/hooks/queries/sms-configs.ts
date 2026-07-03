import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, SmsConfig, SmsProvider } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface SmsConfigListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  provider?: SmsProvider;
  status?: string;
}

export const smsConfigKeys = {
  all: ['sms-configs'] as const,
  lists: ['sms-configs', 'list'] as const,
  list: (params: SmsConfigListParams) => ['sms-configs', 'list', params] as const,
  detail: (id: number | undefined) => ['sms-configs', 'detail', id] as const,
};

export function useSmsConfigList(params: SmsConfigListParams) {
  return useQuery({
    queryKey: smsConfigKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<SmsConfig>>(`/api/sms-configs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSmsConfigDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: smsConfigKeys.detail(id),
    queryFn: () => request.get<SmsConfig>(`/api/sms-configs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveSmsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<SmsConfig> }) =>
      (id === undefined
        ? request.post<SmsConfig>('/api/sms-configs', values)
        : request.put<SmsConfig>(`/api/sms-configs/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsConfigKeys.all }),
  });
}

export function useSetDefaultSmsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/sms-configs/${id}/default`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsConfigKeys.all }),
  });
}

export function useDeleteSmsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/sms-configs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsConfigKeys.all }),
  });
}
