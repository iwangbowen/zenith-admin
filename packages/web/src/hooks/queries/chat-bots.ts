import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { chatBotContract, chatContract, type ChatConversation } from '@zenith/shared/chat';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

const silentRequest = { silent: true } as const;

export type ChatBotListParams = QueryOf<typeof chatBotContract.list>;

/** 新增与编辑共用同一表单：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
export type SaveChatBotValues = Partial<BodyOf<typeof chatBotContract.create>>;

const CHAT_BOT_KEY = resourceKeyOf(chatBotContract.basePath);

export const chatBotKeys = {
  all: [CHAT_BOT_KEY] as const,
  lists: contractKey(chatBotContract.list),
  list: (params: ChatBotListParams) => contractKey(chatBotContract.list, { query: params }),
};

/** 本域只有列表查询，列表行即完整实体（令牌已脱敏）：任何写操作后失效全部列表页即可，不必广播资源根 */
function invalidateChatBots(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: chatBotKeys.lists });
}

export function useChatBotList(params: ChatBotListParams) {
  return useApiQuery(chatBotContract.list, { query: params }, { placeholderData: keepPreviousData });
}

const selectGroupConversations = (items: ChatConversation[]) => items.filter((item) => item.type === 'group');

/** 机器人表单的目标会话下拉源：会话列表归 chat 域所有，这里只对其共享缓存做 select 派生，不另起请求 */
export function useChatBotGroupConversations(enabled = true) {
  return useApiQuery(chatContract.conversations, {
    staleTime: LOOKUP_STALE_TIME,
    requestOptions: silentRequest,
    select: selectGroupConversations,
    enabled,
  });
}

/** 无 id 走创建（POST），有 id 走更新（PATCH） */
export function useSaveChatBot() {
  return useSaveMutation(chatBotContract.create, chatBotContract.update, {
    invalidate: (qc) => invalidateChatBots(qc),
  });
}

export function useRegenerateChatBotToken() {
  return useApiMutation(chatBotContract.regenerateToken, { invalidate: invalidateChatBots });
}

export function useDeleteChatBot() {
  return useApiMutation(chatBotContract.remove, { invalidate: invalidateChatBots });
}
