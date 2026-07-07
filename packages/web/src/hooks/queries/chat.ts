import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Channel,
  ChannelMenu,
  ChannelMessage,
  ChatConversation,
  ChatCustomEmoji,
  ChatGroupInvite,
  ChatGroupJoinRequest,
  ChatGroupMember,
  ChatInviteInfo,
  ChatOrgData,
  ChatQuickReply,
  ChatScheduledMessage,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import type { ChatUser } from '@/pages/chat/types';

export interface ChatUserSearchParams {
  keyword?: string;
}

export interface DiscoverableChannelParams {
  keyword?: string;
}

export interface ChannelMessageParams {
  channelId: number;
  page: number;
  pageSize: number;
}

export const chatKeys = {
  all: ['chat'] as const,
  lists: ['chat', 'list'] as const,
  list: (scope: string, params: object) => ['chat', 'list', scope, params] as const,
  conversations: ['chat', 'conversations'] as const,
  channels: ['chat', 'channels'] as const,
  discoverableChannels: (params: DiscoverableChannelParams) => ['chat', 'list', 'discoverable-channels', params] as const,
  users: (params: ChatUserSearchParams) => ['chat', 'list', 'users', params] as const,
  groupMembers: (conversationId: number | undefined) => ['chat', 'conversations', conversationId, 'members'] as const,
  orgData: ['chat', 'org-data'] as const,
  quickReplies: ['chat', 'quick-replies'] as const,
  scheduledMessages: ['chat', 'scheduled-messages'] as const,
  customEmojis: ['chat', 'custom-emojis'] as const,
  joinRequests: (conversationId: number | undefined) => ['chat', 'conversations', conversationId, 'join-requests'] as const,
  channelMessages: (params: ChannelMessageParams) => ['chat', 'list', 'channel-messages', params] as const,
  channelMenus: (channelId: number | undefined) => ['chat', 'channels', channelId, 'menus'] as const,
};

export function useDiscoverableChannels(params: DiscoverableChannelParams, enabled = true) {
  return useQuery({
    queryKey: chatKeys.discoverableChannels(params),
    queryFn: () => request.get<Channel[]>(`/api/channels/discoverable${toQueryString(params)}`, { silent: true }).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useChatUsers(params: ChatUserSearchParams) {
  return useQuery({
    queryKey: chatKeys.users(params),
    queryFn: () => request.get<ChatUser[]>(`/api/chat/users${toQueryString(params)}`, { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    placeholderData: keepPreviousData,
  });
}

export function useChatGroupMembers(conversationId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: chatKeys.groupMembers(conversationId),
    queryFn: () => request.get<ChatGroupMember[]>(`/api/chat/conversations/${conversationId}/members`, { silent: true }).then(unwrap),
    enabled: enabled && conversationId !== undefined,
  });
}

export function useChatOrgData(enabled = true) {
  return useQuery({
    queryKey: chatKeys.orgData,
    queryFn: () => request.get<ChatOrgData>('/api/chat/org-users', { silent: true }).then(unwrap),
    enabled,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useAddChatGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: number; userId: number }) =>
      request.post<null>(`/api/chat/conversations/${conversationId}/members`, { userId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useRemoveChatGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, memberId }: { conversationId: number; memberId: number }) =>
      request.delete<null>(`/api/chat/conversations/${conversationId}/members/${memberId}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useTransferChatGroupOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, newOwnerId }: { conversationId: number; newOwnerId: number }) =>
      request.post<null>(`/api/chat/conversations/${conversationId}/transfer`, { newOwnerId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useSetChatMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId, role }: { conversationId: number; userId: number; role: 'admin' | 'member' }) =>
      request.patch<null>(`/api/chat/conversations/${conversationId}/members/${userId}/role`, { role }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useMuteChatMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId, mute, durationMinutes }: { conversationId: number; userId: number; mute: boolean; durationMinutes?: number }) =>
      request.patch<null>(`/api/chat/conversations/${conversationId}/members/${userId}/mute`, { mute, ...(durationMinutes ? { durationMinutes } : {}) }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useSetChatMuteAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, muteAll }: { conversationId: number; muteAll: boolean }) =>
      request.patch<null>(`/api/chat/conversations/${conversationId}/mute-all`, { muteAll }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

// ─── 常用语（个人快捷回复） ───────────────────────────────────────────────────

export function useChatQuickReplies(enabled = true) {
  return useQuery({
    queryKey: chatKeys.quickReplies,
    queryFn: () => request.get<ChatQuickReply[]>('/api/chat/quick-replies', { silent: true }).then(unwrap),
    enabled,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveChatQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id?: number; content: string }) =>
      (id === undefined
        ? request.post<ChatQuickReply>('/api/chat/quick-replies', { content })
        : request.put<ChatQuickReply>(`/api/chat/quick-replies/${id}`, { content })
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.quickReplies }),
  });
}

export function useDeleteChatQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/chat/quick-replies/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.quickReplies }),
  });
}

// ─── 定时消息 ─────────────────────────────────────────────────────────────────

export function useMyScheduledMessages(enabled = true) {
  return useQuery({
    queryKey: chatKeys.scheduledMessages,
    queryFn: () => request.get<ChatScheduledMessage[]>('/api/chat/scheduled-messages', { silent: true }).then(unwrap),
    enabled,
  });
}

export function useCreateScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, content, scheduledAt }: { conversationId: number; content: string; scheduledAt: string }) =>
      request.post<ChatScheduledMessage>(`/api/chat/conversations/${conversationId}/scheduled-messages`, { content, scheduledAt }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.scheduledMessages }),
  });
}

export function useCancelScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.patch<null>(`/api/chat/scheduled-messages/${id}/cancel`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.scheduledMessages }),
  });
}

// ─── 自定义表情 ───────────────────────────────────────────────────────────────

export function useChatCustomEmojis(enabled = true) {
  return useQuery({
    queryKey: chatKeys.customEmojis,
    queryFn: () => request.get<ChatCustomEmoji[]>('/api/chat/custom-emojis', { silent: true }).then(unwrap),
    enabled,
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useAddChatCustomEmoji() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { url: string; fileId?: string | null; name?: string | null; width?: number | null; height?: number | null }) =>
      request.post<ChatCustomEmoji>('/api/chat/custom-emojis', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.customEmojis }),
  });
}

export function useDeleteChatCustomEmoji() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/chat/custom-emojis/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.customEmojis }),
  });
}

// ─── 群邀请 / 入群审批 ────────────────────────────────────────────────────────

export function useChatGroupInvite() {
  return useMutation({
    mutationFn: (conversationId: number) =>
      request.post<ChatGroupInvite>(`/api/chat/conversations/${conversationId}/invite`, {}).then(unwrap),
  });
}

export function useResetChatGroupInvite() {
  return useMutation({
    mutationFn: (conversationId: number) =>
      request.post<ChatGroupInvite>(`/api/chat/conversations/${conversationId}/invite/reset`, {}).then(unwrap),
  });
}

export function useChatInviteInfo(token: string | null) {
  return useQuery({
    queryKey: ['chat', 'invite-info', token] as const,
    queryFn: () => request.get<ChatInviteInfo>(`/api/chat/invites/${token}`, { silent: true }).then(unwrap),
    enabled: !!token,
    retry: false,
  });
}

export function useJoinChatByInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ token, message }: { token: string; message?: string }) =>
      request.post<{ joined: boolean }>(`/api/chat/invites/${token}/join`, { ...(message ? { message } : {}) }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useChatJoinRequests(conversationId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: chatKeys.joinRequests(conversationId),
    queryFn: () => request.get<ChatGroupJoinRequest[]>(`/api/chat/conversations/${conversationId}/join-requests`, { silent: true }).then(unwrap),
    enabled: enabled && conversationId !== undefined,
  });
}

export function useHandleChatJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      request.patch<null>(`/api/chat/join-requests/${id}`, { approve }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useSetChatJoinApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, enabled }: { conversationId: number; enabled: boolean }) =>
      request.patch<null>(`/api/chat/conversations/${conversationId}/join-approval`, { enabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.conversations }),
  });
}

export function useUpdateChatGroupInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, values }: { conversationId: number; values: { name?: string; announcement?: string | null } }) =>
      request.patch<null>(`/api/chat/conversations/${conversationId}/group-info`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useCreateChatGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, memberIds }: { name: string; memberIds?: number[] }) =>
      request.post<ChatConversation>('/api/chat/conversations/group', { name, ...(memberIds?.length ? { memberIds } : {}) }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
  });
}

export function useChannelMessages(params: ChannelMessageParams) {
  return useQuery({
    queryKey: chatKeys.channelMessages(params),
    queryFn: () =>
      request.get<{ list: ChannelMessage[]; total: number }>(
        `/api/channels/${params.channelId}/messages${toQueryString({ page: params.page, pageSize: params.pageSize })}`,
        { silent: true },
      ).then(unwrap),
  });
}

export function useChannelMenus(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: chatKeys.channelMenus(channelId),
    queryFn: () => request.get<ChannelMenu[]>(`/api/channels/${channelId}/menus`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined,
    staleTime: LOOKUP_STALE_TIME,
  });
}
