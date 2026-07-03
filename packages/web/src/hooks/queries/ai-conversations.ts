import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiConversation, AiMessage } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface AiConversationListParams {
  keyword?: string;
  archived?: string;
}

export const aiConversationKeys = {
  all: ['ai-conversations'] as const,
  lists: ['ai-conversations', 'list'] as const,
  list: (params: AiConversationListParams) => ['ai-conversations', 'list', params] as const,
  messages: (id: number | null | undefined) => ['ai-conversations', 'messages', id] as const,
};

export function useAiConversationList(params: AiConversationListParams) {
  return useQuery({
    queryKey: aiConversationKeys.list(params),
    queryFn: () => request.get<AiConversation[]>(`/api/ai/conversations${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useAiConversationMessages(id: number | null | undefined) {
  return useQuery({
    queryKey: aiConversationKeys.messages(id),
    queryFn: () => request.get<AiMessage[]>(`/api/ai/conversations/${id}/messages`).then(unwrap),
    enabled: !!id,
  });
}

export function useCreateAiConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { title: string }) => request.post<AiConversation>('/api/ai/conversations', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiConversationKeys.all }),
  });
}
