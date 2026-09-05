import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { aiConversationContract } from '@zenith/shared/ai';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

/** 侧栏列表的筛选条件；分页参数（limit / offset）由无限加载自行补充 */
export type AiConversationListParams = Pick<NonNullable<QueryOf<typeof aiConversationContract.list>>, 'keyword' | 'archived'>;

/** 会话列表分页大小（侧栏无限加载） */
export const AI_CONV_PAGE_SIZE = 30;

export const aiConversationKeys = {
  all: [resourceKeyOf(aiConversationContract.basePath)] as const,
  lists: contractKey(aiConversationContract.list),
  list: (params: AiConversationListParams) => contractKey(aiConversationContract.list, { query: params }),
  messages: (id: number | null | undefined) => contractKey(aiConversationContract.messages, { params: { id: id ?? 0 } }),
};

/** 会话列表无限加载（offset 分页，末页不足 pageSize 即为最后一页） */
export function useInfiniteAiConversationList(params: AiConversationListParams) {
  return useInfiniteQuery({
    queryKey: aiConversationKeys.list(params),
    queryFn: ({ pageParam }) =>
      api(aiConversationContract.list, { query: { ...params, limit: AI_CONV_PAGE_SIZE, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < AI_CONV_PAGE_SIZE ? undefined : allPages.reduce((acc, p) => acc + p.length, 0),
    placeholderData: keepPreviousData,
  });
}

export function useAiConversationMessages(id: number | null | undefined) {
  return useApiQuery(aiConversationContract.messages, { params: { id: id ?? 0 } }, { enabled: !!id });
}

/** 新建对话会出现在任意筛选条件的列表里，整体失效本域 */
export function useCreateAiConversation() {
  return useApiMutation(aiConversationContract.create, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: aiConversationKeys.all }),
  });
}
