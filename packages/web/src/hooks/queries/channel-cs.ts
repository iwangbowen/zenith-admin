import type { QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { channelCsContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery, useSaveMutation } from '@/lib/contract-query';

export type ChannelConversationParams = NonNullable<QueryOf<typeof channelCsContract.conversations>>;

export type ChannelConversationMessagesParams = NonNullable<QueryOf<typeof channelCsContract.conversationMessages>>;

/** 新建 / 编辑快捷回复共用的表单载荷 */
export type ChannelQuickReplyValues = Partial<NonNullable<BodyOf<typeof channelCsContract.createQuickReply>>>;

/**
 * 客服工作台的 key 全部由 `channelCsContract` 派生（与频道管理同属 `channels` 资源键，靠操作名区分）。
 * 「某运营号 / 某会话的全部分页」这类前缀用 `query: {}` 表达：TanStack 对对象段做深部分匹配，
 * 空对象命中任意筛选 / 分页条件。
 */
export const channelCsKeys = {
  channels: contractKey(channelCsContract.csChannels),
  agents: contractKey(channelCsContract.csAgents),
  performance: contractKey(channelCsContract.csPerformance),
  /** 全部运营号的会话列表 */
  conversationsAll: contractKey(channelCsContract.conversations),
  /** 某运营号的全部会话列表查询（任意筛选条件） */
  channelConversations: (channelId: number | undefined) =>
    contractKey(channelCsContract.conversations, { params: { id: channelId ?? 0 }, query: {} }),
  conversations: (channelId: number | undefined, params: ChannelConversationParams) =>
    contractKey(channelCsContract.conversations, { params: { id: channelId ?? 0 }, query: params }),
  /** 某会话（运营号 × 用户）的全部消息流分页 */
  conversationMessages: (channelId: number | undefined, userId: number | undefined) =>
    contractKey(channelCsContract.conversationMessages, { params: { id: channelId ?? 0, userId: userId ?? 0 }, query: {} }),
  messages: (channelId: number | undefined, userId: number | undefined, params: ChannelConversationMessagesParams) =>
    contractKey(channelCsContract.conversationMessages, { params: { id: channelId ?? 0, userId: userId ?? 0 }, query: params }),
  /** 全部快捷回复查询（全局 + 各运营号） */
  quickRepliesAll: contractKey(channelCsContract.quickReplies),
  quickReplies: (channelId: number | undefined) => contractKey(channelCsContract.quickReplies, { query: { channelId } }),
};

const silent = { silent: true } as const;

export function useCsChannels() {
  return useApiQuery(channelCsContract.csChannels, { requestOptions: silent });
}

export function useChannelCsAgents() {
  return useApiQuery(channelCsContract.csAgents, { requestOptions: silent });
}

export function useChannelConversations(channelId: number | undefined, params: ChannelConversationParams, enabled = true) {
  return useApiQuery(channelCsContract.conversations, { params: { id: channelId ?? 0 }, query: params }, {
    enabled: enabled && channelId !== undefined,
    refetchInterval: 30_000,
    requestOptions: silent,
  });
}

export function useChannelConversationMessages(
  channelId: number | undefined,
  userId: number | undefined,
  params: ChannelConversationMessagesParams,
  enabled = true,
) {
  return useApiQuery(channelCsContract.conversationMessages, { params: { id: channelId ?? 0, userId: userId ?? 0 }, query: params }, {
    enabled: enabled && channelId !== undefined && userId !== undefined,
    refetchInterval: 15_000,
    requestOptions: silent,
  });
}

export function useChannelQuickReplies(channelId: number | undefined, enabled = true) {
  return useApiQuery(channelCsContract.quickReplies, { query: { channelId } }, {
    enabled: enabled && channelId !== undefined,
    requestOptions: silent,
  });
}

export function useChannelCsPerformance(enabled = true) {
  return useApiQuery(channelCsContract.csPerformance, { enabled, requestOptions: silent });
}

/**
 * 会话治理动作（回复 / 指派 / 解决 / 打标签）只改变该运营号下的会话聚合行；
 * 运营号列表、客服名单、快捷回复与其它运营号的会话都不受影响，故不再整树广播。
 */
function invalidateConversation(qc: QueryClient, channelId: number) {
  void qc.invalidateQueries({ queryKey: channelCsKeys.channelConversations(channelId) });
}

/** 回复新增一条 out 消息：会话摘要（lastMessage / unreadCount）、该会话消息流与客服绩效（replyCount / 首响）一起刷新 */
export function useReplyChannelConversation() {
  return useApiMutation(channelCsContract.reply, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => {
      invalidateConversation(qc, params.id);
      void qc.invalidateQueries({ queryKey: channelCsKeys.conversationMessages(params.id, params.userId) });
      void qc.invalidateQueries({ queryKey: channelCsKeys.performance });
    },
  });
}

/** 指派只改会话行的 assignee / status，不产生消息也不计入绩效 */
export function useAssignChannelConversation() {
  return useApiMutation(channelCsContract.assign, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => invalidateConversation(qc, params.id),
  });
}

/** 标记解决改会话状态并计入客服的 resolvedCount */
export function useResolveChannelConversation() {
  return useApiMutation(channelCsContract.resolve, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => {
      invalidateConversation(qc, params.id);
      void qc.invalidateQueries({ queryKey: channelCsKeys.performance });
    },
  });
}

/** 标签是会话行字段 */
export function useSetChannelConversationTags() {
  return useApiMutation(channelCsContract.setTags, {
    invalidate: (qc, _output, { params }) => invalidateConversation(qc, params.id),
  });
}

/** 快捷回复分全局与运营号两级，某运营号的列表同时包含全局项，故按操作前缀整体刷新 */
export function useSaveChannelQuickReply() {
  return useSaveMutation(channelCsContract.createQuickReply, channelCsContract.updateQuickReply, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: channelCsKeys.quickRepliesAll }),
  });
}

export function useDeleteChannelQuickReply() {
  return useApiMutation(channelCsContract.removeQuickReply, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: channelCsKeys.quickRepliesAll }),
  });
}
