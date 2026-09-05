import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatContract } from '@zenith/shared/chat';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { channelContract } from '@zenith/shared/messaging';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type ChatUserSearchParams = QueryOf<typeof chatContract.users>;

export interface DiscoverableChannelParams {
  keyword?: string;
}

export interface ChannelMessageParams {
  channelId: number;
  page: number;
  pageSize: number;
}

/** 契约操作的请求选项：聊天页的查询失败由界面自行兜底，不弹全局错误提示 */
const silent = { silent: true } as const;

/** 契约 query key 的资源前缀（`contractKey` 的首段），用于按操作整体失效 */
const CHAT_KEY = resourceKeyOf(chatContract.basePath);

export const chatKeys = {
  all: [CHAT_KEY] as const,
  lists: [CHAT_KEY, 'list'] as const,
  list: (scope: string, params: object) => [CHAT_KEY, 'list', scope, params] as const,
  /**
   * 会话列表。当前由 ChatPage 以本地 state + WebSocket 增量维护，尚未迁入 Query，
   * 但会话级 mutation 仍以此为约定失效目标，便于后续迁移时自动接上。
   */
  conversations: contractKey(chatContract.conversations),
  /** 顶栏聊天未读数聚合（初值由查询拉取，之后由 WebSocket 推送写入缓存） */
  unreadCount: [CHAT_KEY, 'unread-count'] as const,
  channels: [CHAT_KEY, 'channels'] as const,
  discoverableChannels: (params: DiscoverableChannelParams) => [CHAT_KEY, 'list', 'discoverable-channels', params] as const,
  users: (params: ChatUserSearchParams) => contractKey(chatContract.users, { query: params }),
  /**
   * 群成员与入群申请刻意不挂在 conversations 之下：
   * 那样会让「刷新会话列表」这一意图连带打掉每个会话的成员名单（前缀匹配）。
   */
  groupMembersAll: contractKey(chatContract.groupMembers),
  groupMembers: (conversationId: number | undefined) => contractKey(chatContract.groupMembers, { params: { id: conversationId ?? 0 } }),
  /** 群公告历史（抽屉打开时才拉取，非实时） */
  announcementHistory: (conversationId: number | undefined) => contractKey(chatContract.announcementHistory, { params: { id: conversationId ?? 0 } }),
  orgData: contractKey(chatContract.orgUsers),
  quickReplies: contractKey(chatContract.quickReplies),
  scheduledMessages: contractKey(chatContract.scheduledMessages),
  customEmojis: contractKey(chatContract.customEmojis),
  joinRequestsAll: contractKey(chatContract.joinRequests),
  joinRequests: (conversationId: number | undefined) => contractKey(chatContract.joinRequests, { params: { id: conversationId ?? 0 } }),
  inviteInfo: (token: string | null) => contractKey(chatContract.inviteInfo, { params: { token: token ?? '' } }),
  channelMessages: (params: ChannelMessageParams) => [CHAT_KEY, 'list', 'channel-messages', params] as const,
  channelMenus: (channelId: number | undefined) => [CHAT_KEY, 'channels', channelId, 'menus'] as const,
};

export function useDiscoverableChannels(params: DiscoverableChannelParams, enabled = true) {
  return useQuery({
    queryKey: chatKeys.discoverableChannels(params),
    queryFn: () => api(channelContract.discoverable, { query: params }, silent),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useChatUsers(params: ChatUserSearchParams, enabled = true) {
  return useApiQuery(chatContract.users, { query: params }, {
    staleTime: LOOKUP_STALE_TIME,
    placeholderData: keepPreviousData,
    enabled,
    requestOptions: silent,
  });
}

export function useChatGroupMembers(conversationId: number | undefined, enabled = true) {
  return useApiQuery(chatContract.groupMembers, { params: { id: conversationId ?? 0 } }, {
    enabled: enabled && conversationId !== undefined,
    requestOptions: silent,
  });
}

export function useChatOrgData(enabled = true) {
  return useApiQuery(chatContract.orgUsers, { enabled, staleTime: LOOKUP_STALE_TIME, requestOptions: silent });
}

/** 群公告历史：抽屉打开时才拉取，非实时数据 */
export function useChatAnnouncementHistory(conversationId: number | undefined, enabled = true) {
  return useApiQuery(chatContract.announcementHistory, { params: { id: conversationId ?? 0 } }, {
    enabled: enabled && conversationId !== undefined,
    requestOptions: silent,
  });
}

export function useDeleteChatAnnouncementHistory() {
  return useApiMutation(chatContract.removeAnnouncementHistory, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.announcementHistory(params.id) });
    },
  });
}

/** 成员变动只影响该会话的成员名单；会话列表不展示成员，故不牵动 conversations */
export function useAddChatGroupMember() {
  return useApiMutation(chatContract.addGroupMember, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembers(params.id) });
    },
  });
}

export function useRemoveChatGroupMember() {
  return useApiMutation(chatContract.removeGroupMember, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembers(params.id) });
    },
  });
}

/** 群主易主会改变各处的操作权限判定，成员名单是唯一来源 */
export function useTransferChatGroupOwner() {
  return useApiMutation(chatContract.transferGroup, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembers(params.id) });
    },
  });
}

export function useSetChatMemberRole() {
  return useApiMutation(chatContract.setMemberRole, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembers(params.id) });
    },
  });
}

export function useMuteChatMember() {
  return useApiMutation(chatContract.muteMember, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembers(params.id) });
    },
  });
}

/** 全员禁言开关是会话字段（ChatConversation.muteAll），成员名单的禁言状态也随之变化 */
export function useSetChatMuteAll() {
  return useApiMutation(chatContract.setMuteAll, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembers(params.id) });
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

// ─── 常用语（个人快捷回复） ───────────────────────────────────────────────────

export function useChatQuickReplies(enabled = true) {
  return useApiQuery(chatContract.quickReplies, { enabled, staleTime: LOOKUP_STALE_TIME, requestOptions: silent });
}

/** 无 id 走新增，有 id 走更新；两者都只影响常用语列表 */
export function useSaveChatQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id?: number; content: string }) =>
      (id === undefined
        ? api(chatContract.createQuickReply, { body: { content } })
        : api(chatContract.updateQuickReply, { params: { id }, body: { content } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.quickReplies }),
  });
}

export function useDeleteChatQuickReply() {
  return useApiMutation(chatContract.removeQuickReply, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.quickReplies });
    },
  });
}

// ─── 定时消息 ─────────────────────────────────────────────────────────────────

export function useMyScheduledMessages(enabled = true) {
  return useApiQuery(chatContract.scheduledMessages, { query: {} }, { enabled, requestOptions: silent });
}

export function useCreateScheduledMessage() {
  return useApiMutation(chatContract.createScheduledMessage, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.scheduledMessages });
    },
  });
}

export function useCancelScheduledMessage() {
  return useApiMutation(chatContract.cancelScheduledMessage, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.scheduledMessages });
    },
  });
}

// ─── 自定义表情 ───────────────────────────────────────────────────────────────

export function useChatCustomEmojis(enabled = true) {
  return useApiQuery(chatContract.customEmojis, { enabled, staleTime: LOOKUP_STALE_TIME, requestOptions: silent });
}

export function useAddChatCustomEmoji() {
  return useApiMutation(chatContract.addCustomEmoji, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.customEmojis });
    },
  });
}

export function useDeleteChatCustomEmoji() {
  return useApiMutation(chatContract.removeCustomEmoji, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.customEmojis });
    },
  });
}

// ─── 群邀请 / 入群审批 ────────────────────────────────────────────────────────

/** 邀请链接只在弹窗内展示，不进入任何列表缓存，故不做失效 */
export function useChatGroupInvite() {
  return useApiMutation(chatContract.createInvite);
}

export function useResetChatGroupInvite() {
  return useApiMutation(chatContract.resetInvite);
}

export function useChatInviteInfo(token: string | null) {
  return useApiQuery(chatContract.inviteInfo, { params: { token: token ?? '' } }, {
    enabled: !!token,
    retry: false,
    requestOptions: silent,
  });
}

/** 入群成功后多出一个会话；若走审批则只是提交申请，会话列表刷新一次也无妨 */
export function useJoinChatByInvite() {
  return useApiMutation(chatContract.joinByInvite, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

export function useChatJoinRequests(conversationId: number | undefined, enabled = true) {
  return useApiQuery(chatContract.joinRequests, { params: { id: conversationId ?? 0 } }, {
    enabled: enabled && conversationId !== undefined,
    requestOptions: silent,
  });
}

/**
 * 接口只给申请 id，定位不到所属会话，退一步失效全部会话的申请与成员名单；
 * 仍不波及常用语、自定义表情、组织架构等静态 lookup
 */
export function useHandleChatJoinRequest() {
  return useApiMutation(chatContract.handleJoinRequest, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.joinRequestsAll });
      void qc.invalidateQueries({ queryKey: chatKeys.groupMembersAll });
    },
  });
}

/** 开关本身由面板持有，开启后才会产生入群申请 */
export function useSetChatJoinApproval() {
  return useApiMutation(chatContract.setJoinApproval, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.joinRequests(params.id) });
    },
  });
}

/** 群名与公告都是 ChatConversation 字段，会话列表直接展示 */
export function useUpdateChatGroupInfo() {
  return useApiMutation(chatContract.updateGroupInfo, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

export function useCreateChatGroup() {
  return useApiMutation(chatContract.createGroup, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });
}

export function useChannelMessages(params: ChannelMessageParams) {
  return useQuery({
    queryKey: chatKeys.channelMessages(params),
    queryFn: () => api(channelContract.messages, {
      params: { id: params.channelId },
      query: { page: params.page, pageSize: params.pageSize },
    }, silent),
  });
}

export function useChannelMenus(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: chatKeys.channelMenus(channelId),
    queryFn: () => api(channelContract.menus, { params: { id: channelId ?? 0 } }, silent),
    enabled: enabled && channelId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/**
 * 顶栏聊天未读数。仅拉取初值，后续增量由 WebSocket 推送经 setQueryData 写入
 * （会话列表本身仍由 ChatPage 以本地 state + WS 维护，属文档白名单的流式场景）。
 */
export function useChatUnreadCount() {
  return useQuery({
    queryKey: chatKeys.unreadCount,
    queryFn: () => api(chatContract.conversations, silent)
      .then((list) => (list ?? []).reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)),
  });
}
