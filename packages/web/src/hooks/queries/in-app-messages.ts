import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InAppMessage, InAppMessageType, InAppTemplate, PaginatedResponse } from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface InAppMessageListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: InAppMessageType;
  isRead?: string;
}

export const inAppMessageKeys = {
  all: ['in-app-messages'] as const,
  lists: ['in-app-messages', 'list'] as const,
  list: (params: InAppMessageListParams) => ['in-app-messages', 'list', params] as const,
};

export function useInAppMessageList(params: InAppMessageListParams) {
  return useQuery({
    queryKey: inAppMessageKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<InAppMessage>>(`/api/in-app-messages/admin${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSendInAppMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => request.post<null>('/api/in-app-messages/send', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inAppMessageKeys.all }),
  });
}

export function useMarkInAppMessageRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/in-app-messages/admin/${id}/read`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inAppMessageKeys.all }),
  });
}

export function useMarkAllInAppMessagesRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.post<null>('/api/in-app-messages/admin/read-all').then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inAppMessageKeys.all }),
  });
}

export function useDeleteInAppMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/in-app-messages/admin/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inAppMessageKeys.all }),
  });
}

export function useEnabledInAppTemplates(enabled = true) {
  return useQuery({
    queryKey: ['in-app-messages', 'enabled-templates'] as const,
    queryFn: () =>
      request
        .get<PaginatedResponse<InAppTemplate>>('/api/in-app-templates?page=1&pageSize=100&status=enabled')
        .then(unwrap),
    enabled,
  });
}
