import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InAppMessage, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface InboxListParams {
  page: number;
  pageSize: number;
  isRead?: string;
}

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: ['inbox', 'list'] as const,
  list: (params: InboxListParams) => ['inbox', 'list', params] as const,
  detail: (id: number | undefined) => ['inbox', 'detail', id] as const,
};

export function useInboxList(params: InboxListParams) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<InAppMessage>>(`/api/in-app-messages${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useInboxMessageDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => request.get<InAppMessage>(`/api/in-app-messages/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useMarkInboxMessageRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/in-app-messages/${id}/read`, undefined, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

export function useMarkAllInboxMessagesRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.post<null>('/api/in-app-messages/read-all', {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

export function useBatchMarkInboxMessagesRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.post<null>('/api/in-app-messages/batch-read', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

export function useBatchDeleteInboxMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.delete<null>('/api/in-app-messages/batch', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

export function useDeleteInboxMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/in-app-messages/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}
