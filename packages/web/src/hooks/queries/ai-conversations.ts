import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiConversation, AiMessage } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface AiConversationListParams {
  keyword?: string;
  archived?: string;
}

/** 会话列表分页大小（侧栏无限加载） */
export const AI_CONV_PAGE_SIZE = 30;

export const aiConversationKeys = {
  all: ['ai-conversations'] as const,
  lists: ['ai-conversations', 'list'] as const,
  list: (params: AiConversationListParams) => ['ai-conversations', 'list', params] as const,
  messages: (id: number | null | undefined) => ['ai-conversations', 'messages', id] as const,
};

/** 会话列表无限加载（offset 分页，末页不足 pageSize 即为最后一页） */
export function useInfiniteAiConversationList(params: AiConversationListParams) {
  return useInfiniteQuery({
    queryKey: aiConversationKeys.list(params),
    queryFn: ({ pageParam }) =>
      request
        .get<AiConversation[]>(
          `/api/ai/conversations${toQueryString({ ...params, limit: AI_CONV_PAGE_SIZE, offset: pageParam })}`,
        )
        .then(unwrap),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < AI_CONV_PAGE_SIZE ? undefined : allPages.reduce((acc, p) => acc + p.length, 0),
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
    mutationFn: (values: { title: string; agentId?: number }) => request.post<AiConversation>('/api/ai/conversations', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiConversationKeys.all }),
  });
}
