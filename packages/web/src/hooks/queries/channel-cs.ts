import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { channelCsContract } from '@zenith/shared/messaging';
import type { ChannelQuickReply } from '@zenith/shared/messaging';
import { api, useApiMutation } from '@/lib/contract-query';

export type ChannelConversationParams = NonNullable<QueryOf<typeof channelCsContract.conversations>>;

export type ChannelConversationMessagesParams = NonNullable<QueryOf<typeof channelCsContract.conversationMessages>>;

/** 新建 / 编辑快捷回复共用的表单载荷 */
export type ChannelQuickReplyValues = Partial<NonNullable<BodyOf<typeof channelCsContract.createQuickReply>>>;

/** 客服工作台自成一棵缓存子树，与频道管理（`channels` 根键）互不牵连 */
const KEY = 'channel-cs';

export const channelCsKeys = {
  all: [KEY] as const,
  channels: [KEY, 'channels'] as const,
  agents: [KEY, 'agents'] as const,
  performance: [KEY, 'performance'] as const,
  /** 全部运营号的会话列表 */
  conversationsAll: [KEY, 'conversations'] as const,
  /** 某运营号的全部会话列表查询（任意筛选条件） */
  channelConversations: (channelId: number | undefined) => [KEY, 'conversations', channelId] as const,
  conversations: (channelId: number | undefined, params: ChannelConversationParams) => [KEY, 'conversations', channelId, params] as const,
  /** 某会话（运营号 × 用户）的全部消息流分页 */
  conversationMessages: (channelId: number | undefined, userId: number | undefined) => [KEY, 'messages', channelId, userId] as const,
  messages: (channelId: number | undefined, userId: number | undefined, params: ChannelConversationMessagesParams) => [KEY, 'messages', channelId, userId, params] as const,
  quickReplies: (channelId: number | undefined) => [KEY, 'quick-replies', channelId] as const,
};

const silent = { silent: true } as const;

export function useCsChannels() {
  return useQuery({
    queryKey: channelCsKeys.channels,
    queryFn: () => api(channelCsContract.csChannels, silent),
  });
}

export function useChannelCsAgents() {
  return useQuery({
    queryKey: channelCsKeys.agents,
    queryFn: () => api(channelCsContract.csAgents, silent),
  });
}

export function useChannelConversations(channelId: number | undefined, params: ChannelConversationParams, enabled = true) {
  return useQuery({
    queryKey: channelCsKeys.conversations(channelId, params),
    queryFn: () => api(channelCsContract.conversations, { params: { id: channelId ?? 0 }, query: params }, silent),
    enabled: enabled && channelId !== undefined,
    refetchInterval: 30_000,
  });
}

export function useChannelConversationMessages(
  channelId: number | undefined,
  userId: number | undefined,
  params: ChannelConversationMessagesParams,
  enabled = true,
) {
  return useQuery({
    queryKey: channelCsKeys.messages(channelId, userId, params),
    queryFn: () => api(channelCsContract.conversationMessages, { params: { id: channelId ?? 0, userId: userId ?? 0 }, query: params }, silent),
    enabled: enabled && channelId !== undefined && userId !== undefined,
    refetchInterval: 15_000,
  });
}

export function useChannelQuickReplies(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: channelCsKeys.quickReplies(channelId),
    queryFn: () => api(channelCsContract.quickReplies, { query: { channelId } }, silent),
    enabled: enabled && channelId !== undefined,
  });
}

export function useChannelCsPerformance(enabled = true) {
  return useQuery({
    queryKey: channelCsKeys.performance,
    queryFn: () => api(channelCsContract.csPerformance, silent),
    enabled,
  });
}

/** 会话治理动作改变会话列表、消息流与绩效，整个工作台子树一起失效 */
function invalidateWorkbench(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: channelCsKeys.all });
}

export function useReplyChannelConversation() {
  return useApiMutation(channelCsContract.reply, { requestOptions: silent, invalidate: invalidateWorkbench });
}

export function useAssignChannelConversation() {
  return useApiMutation(channelCsContract.assign, { requestOptions: silent, invalidate: invalidateWorkbench });
}

export function useResolveChannelConversation() {
  return useApiMutation(channelCsContract.resolve, { requestOptions: silent, invalidate: invalidateWorkbench });
}

export function useSetChannelConversationTags() {
  return useApiMutation(channelCsContract.setTags, { invalidate: invalidateWorkbench });
}

export function useSaveChannelQuickReply() {
  const qc = useQueryClient();
  return useMutation<ChannelQuickReply, Error, { id?: number; values: ChannelQuickReplyValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(channelCsContract.createQuickReply, { body: values as BodyOf<typeof channelCsContract.createQuickReply> })
        : api(channelCsContract.updateQuickReply, { params: { id }, body: values }),
    onSuccess: () => invalidateWorkbench(qc),
  });
}

export function useDeleteChannelQuickReply() {
  return useApiMutation(channelCsContract.removeQuickReply, { invalidate: invalidateWorkbench });
}
