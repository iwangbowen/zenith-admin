import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatConversation, ChatWebhook, PaginatedResponse } from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface ChatBotListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const chatBotKeys = {
  all: ['chat-bots'] as const,
  lists: ['chat-bots', 'list'] as const,
  list: (params: ChatBotListParams) => ['chat-bots', 'list', params] as const,
  groupConversations: ['chat-bots', 'group-conversations'] as const,
};

export function useChatBotList(params: ChatBotListParams) {
  return useQuery({
    queryKey: chatBotKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ChatWebhook>>(`/api/chat-bots${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useChatBotGroupConversations(enabled = true) {
  return useQuery({
    queryKey: chatBotKeys.groupConversations,
    queryFn: () => request.get<ChatConversation[]>('/api/chat/conversations').then(unwrap),
    select: (items) => items.filter((item) => item.type === 'group'),
    enabled,
  });
}

export function useSaveChatBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<ChatWebhook>('/api/chat-bots', values)
        : request.patch<ChatWebhook>(`/api/chat-bots/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatBotKeys.all }),
  });
}

export function useRegenerateChatBotToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<ChatWebhook>(`/api/chat-bots/${id}/regenerate-token`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatBotKeys.all }),
  });
}

export function useDeleteChatBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/chat-bots/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatBotKeys.all }),
  });
}
