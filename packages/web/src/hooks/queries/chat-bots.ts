import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chatBotContract, type ChatConversation } from '@zenith/shared/chat';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { conversationsQueryOptions } from '@/hooks/queries/chat';

export type ChatBotListParams = QueryOf<typeof chatBotContract.list>;

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveChatBotValues = Partial<BodyOf<typeof chatBotContract.create>>;

const CHAT_BOT_KEY = resourceKeyOf(chatBotContract.basePath);

export const chatBotKeys = {
  all: [CHAT_BOT_KEY] as const,
  lists: contractKey(chatBotContract.list),
  list: (params: ChatBotListParams) => contractKey(chatBotContract.list, { query: params }),
};

/** 列表行即完整实体（令牌已脱敏），任何写操作后整体失效即可 */
function invalidateChatBots(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: chatBotKeys.all });
}

export function useChatBotList(params: ChatBotListParams) {
  return useApiQuery(chatBotContract.list, { query: params }, { placeholderData: keepPreviousData });
}

const selectGroupConversations = (items: ChatConversation[]) => items.filter((item) => item.type === 'group');

/** 机器人表单的目标会话下拉源：会话列表归 chat 域所有，这里只对其共享缓存做 select 派生，不另起请求 */
export function useChatBotGroupConversations(enabled = true) {
  return useQuery({ ...conversationsQueryOptions(), select: selectGroupConversations, enabled });
}

/** 无 id 走创建（POST），有 id 走更新（PATCH） */
export function useSaveChatBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SaveChatBotValues }) =>
      (id === undefined
        ? api(chatBotContract.create, { body: values as BodyOf<typeof chatBotContract.create> })
        : api(chatBotContract.update, { params: { id }, body: values })),
    onSuccess: () => invalidateChatBots(qc),
  });
}

export function useRegenerateChatBotToken() {
  return useApiMutation(chatBotContract.regenerateToken, { invalidate: invalidateChatBots });
}

export function useDeleteChatBot() {
  return useApiMutation(chatBotContract.remove, { invalidate: invalidateChatBots });
}
