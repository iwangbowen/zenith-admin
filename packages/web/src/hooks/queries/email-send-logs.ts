import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailSendLog, PaginatedResponse, SendStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface EmailSendLogListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  toEmail?: string;
  status?: SendStatus;
  source?: string;
}

export const emailSendLogKeys = {
  all: ['email-send-logs'] as const,
  lists: ['email-send-logs', 'list'] as const,
  list: (params: EmailSendLogListParams) => ['email-send-logs', 'list', params] as const,
  detail: (id: number | undefined) => ['email-send-logs', 'detail', id] as const,
};

export function useEmailSendLogList(params: EmailSendLogListParams) {
  return useQuery({
    queryKey: emailSendLogKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<EmailSendLog>>(`/api/email-send-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useTestEmailSendLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/email-send-logs/test', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailSendLogKeys.all }),
  });
}

export function useDeleteEmailSendLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/email-send-logs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailSendLogKeys.all }),
  });
}
