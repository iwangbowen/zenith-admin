import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, SendStatus, SmsSendLog } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface SmsSendLogListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  phone?: string;
  status?: SendStatus;
  source?: string;
}

export const smsSendLogKeys = {
  all: ['sms-send-logs'] as const,
  lists: ['sms-send-logs', 'list'] as const,
  list: (params: SmsSendLogListParams) => ['sms-send-logs', 'list', params] as const,
  detail: (id: number | undefined) => ['sms-send-logs', 'detail', id] as const,
};

export function useSmsSendLogList(params: SmsSendLogListParams) {
  return useQuery({
    queryKey: smsSendLogKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<SmsSendLog>>(`/api/sms-send-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useTestSmsSendLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/sms-send-logs/test', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsSendLogKeys.all }),
  });
}

export function useDeleteSmsSendLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/sms-send-logs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: smsSendLogKeys.all }),
  });
}
