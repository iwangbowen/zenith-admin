import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Channel,
  ChannelMenu,
  ChannelMessage,
  ChatConversation,
  ChatGroupMember,
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
    mutationFn: (name: string) =>
      request.post<ChatConversation>('/api/chat/conversations/group', { name }).then(unwrap),
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
