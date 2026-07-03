import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelAdmin,
  ChannelAutoReply,
  ChannelMenu,
  ChannelMessage,
  ChannelMessageTemplate,
  ChannelSubscriber,
  PaginatedResponse,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface ChannelListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export interface ChannelMessagesParams {
  page: number;
  pageSize: number;
  status?: 'sent' | 'draft' | 'scheduled';
}

export interface ChannelSubscribersParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const channelKeys = {
  all: ['channels'] as const,
  lists: ['channels', 'list'] as const,
  list: (params: ChannelListParams) => ['channels', 'list', params] as const,
  menus: (channelId: number | undefined) => ['channels', 'menus', channelId] as const,
  autoReplies: (channelId: number | undefined) => ['channels', 'auto-replies', channelId] as const,
  messages: (channelId: number | undefined, params: ChannelMessagesParams) => ['channels', 'messages', channelId, params] as const,
  subscribers: (channelId: number | undefined, params: ChannelSubscribersParams) => ['channels', 'subscribers', channelId, params] as const,
  templates: ['channels', 'templates'] as const,
};

export function useChannelList(params: ChannelListParams) {
  return useQuery({
    queryKey: channelKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ChannelAdmin>>(`/api/channels/admin${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useChannelMenus(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: channelKeys.menus(channelId),
    queryFn: () => request.get<ChannelMenu[]>(`/api/channels/${channelId}/menus`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined,
  });
}

export function useChannelAutoReplies(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: channelKeys.autoReplies(channelId),
    queryFn: () => request.get<ChannelAutoReply[]>(`/api/channels/${channelId}/auto-replies`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined,
  });
}

export function useChannelMessages(channelId: number | undefined, params: ChannelMessagesParams, enabled = true) {
  return useQuery({
    queryKey: channelKeys.messages(channelId, params),
    queryFn: () =>
      request.get<PaginatedResponse<ChannelMessage>>(`/api/channels/admin/${channelId}/messages${toQueryString(params)}`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useChannelSubscribers(channelId: number | undefined, params: ChannelSubscribersParams, enabled = true) {
  return useQuery({
    queryKey: channelKeys.subscribers(channelId, params),
    queryFn: () =>
      request.get<PaginatedResponse<ChannelSubscriber>>(`/api/channels/admin/${channelId}/subscribers${toQueryString(params)}`, { silent: true }).then(unwrap),
    enabled: enabled && channelId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useChannelTemplates(enabled = true) {
  return useQuery({
    queryKey: channelKeys.templates,
    queryFn: () => request.get<ChannelMessageTemplate[]>('/api/channels/templates', { silent: true }).then(unwrap),
    enabled,
  });
}

export function useSaveChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined ? request.post<ChannelAdmin>('/api/channels', values) : request.put<ChannelAdmin>(`/api/channels/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/channels/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useSaveChannelMenus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, menus }: { channelId: number; menus: unknown[] }) =>
      request.put<ChannelMenu[]>(`/api/channels/${channelId}/menus`, { menus }).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: channelKeys.menus(variables.channelId) });
      void qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useSaveChannelAutoReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id, values }: { channelId: number; id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<ChannelAutoReply>(`/api/channels/${channelId}/auto-replies`, values)
        : request.put<ChannelAutoReply>(`/api/channels/${channelId}/auto-replies/${id}`, values)
      ).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: channelKeys.autoReplies(variables.channelId) });
      void qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useDeleteChannelAutoReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: number; id: number }) =>
      request.delete<null>(`/api/channels/${channelId}/auto-replies/${id}`).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: channelKeys.autoReplies(variables.channelId) });
      void qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function usePublishChannelMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id, values }: { channelId: number; id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<ChannelMessage>(`/api/channels/${channelId}/publish`, values)
        : request.put<ChannelMessage>(`/api/channels/admin/messages/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useDeleteChannelMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/channels/admin/messages/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function usePublishChannelMessageNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<ChannelMessage>(`/api/channels/admin/messages/${id}/publish`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useRetractChannelMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/channels/admin/messages/${id}/retract`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.all }),
  });
}

export function useTestSendChannelMessage() {
  return useMutation({
    mutationFn: ({ channelId, values }: { channelId: number; values: Record<string, unknown> }) =>
      request.post<ChannelMessage>(`/api/channels/${channelId}/test-send`, values).then(unwrap),
  });
}

export function useAudienceEstimate() {
  return useMutation({
    mutationFn: (audience: Record<string, unknown>) =>
      request.post<{ count: number }>('/api/channels/audience-estimate', { audience }, { silent: true }).then(unwrap),
  });
}

export function useSaveChannelTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<ChannelMessageTemplate>('/api/channels/templates', values)
        : request.put<ChannelMessageTemplate>(`/api/channels/templates/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.templates }),
  });
}

export function useDeleteChannelTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/channels/templates/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.templates }),
  });
}

export function useAddChannelSubscribers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, userIds }: { channelId: number; userIds: number[] }) =>
      request.post<null>(`/api/channels/admin/${channelId}/subscribers`, { userIds }).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['channels', 'subscribers', variables.channelId] });
      void qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

export function useRemoveChannelSubscriber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, userId }: { channelId: number; userId: number }) =>
      request.delete<null>(`/api/channels/admin/${channelId}/subscribers/${userId}`).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['channels', 'subscribers', variables.channelId] });
      void qc.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}
