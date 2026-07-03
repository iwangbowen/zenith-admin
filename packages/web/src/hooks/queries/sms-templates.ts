import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, SmsProvider, SmsTemplate } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface SmsTemplateListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  provider?: SmsProvider;
  status?: string;
}

export const smsTemplateKeys = {
  all: ['sms-templates'] as const,
  lists: ['sms-templates', 'list'] as const,
  list: (params: SmsTemplateListParams) => ['sms-templates', 'list', params] as const,
  detail: (id: number | undefined) => ['sms-templates', 'detail', id] as const,
};

export function useSmsTemplateList(params: SmsTemplateListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: smsTemplateKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<SmsTemplate>>(`/api/sms-templates${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useSmsTemplateDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: smsTemplateKeys.detail(id),
    queryFn: () => request.get<SmsTemplate>(`/api/sms-templates/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveSmsTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<SmsTemplate> }) =>
      (id === undefined
        ? request.post<SmsTemplate>('/api/sms-templates', values)
        : request.put<SmsTemplate>(`/api/sms-templates/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsTemplateKeys.all }),
  });
}

export function useDeleteSmsTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/sms-templates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsTemplateKeys.all }),
  });
}
