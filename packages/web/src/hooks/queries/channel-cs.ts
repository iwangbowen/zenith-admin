import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelConversation,
  ChannelConversationStatus,
  ChannelCsAgent,
  ChannelCsPerformance,
  ChannelMessage,
  ChannelQuickReply,
  PaginatedResponse,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface CsChannel {
  id: number;
  name: string;
  avatar: string | null;
}

export interface ChannelConversationParams {
  status?: ChannelConversationStatus;
  assignee?: 'mine' | 'unassigned' | 'all';
  keyword?: string;
  tag?: string;
}

export interface ChannelConversationMessagesParams {
  page: number;
  pageSize: number;
}

export const channelCsKeys = {
  all: ['channel-cs'] as const,
  channels: ['channel-cs', 'channels'] as const,
  agents: ['channel-cs', 'agents'] as const,
  performance: ['channel-cs', 'performance'] as const,
  conversations: (channelId: number | undefined, params: ChannelConversationParams) => ['channel-cs', 'conversations', channelId, params] as const,
  messages: (channelId: number | undefined, userId: number | undefined, params: ChannelConversationMessagesParams) => ['channel-cs', 'messages', channelId, userId, params] as const,
  quickReplies: (channelId: number | undefined) => ['channel-cs', 'quick-replies', channelId] as const,
};

export function useCsChannels() {
  return useQuery({
    queryKey: channelCsKeys.channels,
    queryFn: () => request.get<CsChannel[]>('/api/channels/cs/channels', { silent: true }).then(unwrap),
  });
}

export function useChannelCsAgents() {
  return useQuery({
    queryKey: channelCsKeys.agents,
    queryFn: () => request.get<ChannelCsAgent[]>('/api/channels/cs/agents', { silent: true }).then(unwrap),
  });
}

export function useChannelConversations(channelId: number | undefined, params: ChannelConversationParams, enabled = true) {
  return useQuery({
    queryKey: channelCsKeys.conversations(channelId, params),
    queryFn: () =>
      request.get<ChannelConversation[]>(`/api/channels/cs/${channelId}/conversations${toQueryString(params)}`, { silent: true }).then(unwrap),
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
    queryFn: () =>
      request.get<PaginatedResponse<ChannelMessage>>(`/api/channels/cs/${channelId}/conversations/${userId}/messages${toQueryString(params)}`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined && userId !== undefined,
    refetchInterval: 15_000,
  });
}

export function useChannelQuickReplies(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: channelCsKeys.quickReplies(channelId),
    queryFn: () => request.get<ChannelQuickReply[]>(`/api/channels/cs/quick-replies${toQueryString({ channelId })}`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined,
  });
}

export function useChannelCsPerformance(enabled = true) {
  return useQuery({
    queryKey: channelCsKeys.performance,
    queryFn: () => request.get<ChannelCsPerformance[]>('/api/channels/cs/performance', { silent: true }).then(unwrap),
    enabled,
  });
}

export function useReplyChannelConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, userId, content }: { channelId: number; userId: number; content: string }) =>
      request.post<ChannelMessage>(`/api/channels/cs/${channelId}/conversations/${userId}/reply`, { content }, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelCsKeys.all }),
  });
}

export function useAssignChannelConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, userId, assigneeId }: { channelId: number; userId: number; assigneeId: number | null }) =>
      request.post<null>(`/api/channels/cs/${channelId}/conversations/${userId}/assign`, { assigneeId }, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelCsKeys.all }),
  });
}

export function useResolveChannelConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, userId }: { channelId: number; userId: number }) =>
      request.post<null>(`/api/channels/cs/${channelId}/conversations/${userId}/resolve`, {}, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelCsKeys.all }),
  });
}

export function useSaveChannelQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<ChannelQuickReply>('/api/channels/cs/quick-replies', values)
        : request.put<ChannelQuickReply>(`/api/channels/cs/quick-replies/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelCsKeys.all }),
  });
}

export function useDeleteChannelQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/channels/cs/quick-replies/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelCsKeys.all }),
  });
}
