import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailTemplate, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface EmailTemplateListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const emailTemplateKeys = {
  all: ['email-templates'] as const,
  lists: ['email-templates', 'list'] as const,
  list: (params: EmailTemplateListParams) => ['email-templates', 'list', params] as const,
  detail: (id: number | undefined) => ['email-templates', 'detail', id] as const,
};

export function useEmailTemplateList(params: EmailTemplateListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: emailTemplateKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<EmailTemplate>>(`/api/email-templates${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useEmailTemplateDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: emailTemplateKeys.detail(id),
    queryFn: () => request.get<EmailTemplate>(`/api/email-templates/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<EmailTemplate> }) =>
      (id === undefined
        ? request.post<EmailTemplate>('/api/email-templates', values)
        : request.put<EmailTemplate>(`/api/email-templates/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailTemplateKeys.all }),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/email-templates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailTemplateKeys.all }),
  });
}
