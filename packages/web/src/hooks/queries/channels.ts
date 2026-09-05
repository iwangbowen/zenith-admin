import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { channelContract, channelMessageContract } from '@zenith/shared/messaging';
import type { ChannelAutoReply, ChannelMessage, ChannelMessageTemplate } from '@zenith/shared/messaging';
import { api, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type ChannelListParams = NonNullable<QueryOf<typeof channelContract.list>>;

export type ChannelMessagesParams = NonNullable<QueryOf<typeof channelMessageContract.adminMessages>>;

export type ChannelSubscribersParams = NonNullable<QueryOf<typeof channelContract.subscribers>>;

/** 群发 / 编辑草稿共用的请求体（`publishChannelSchema`） */
export type ChannelPublishValues = NonNullable<BodyOf<typeof channelMessageContract.publish>>;

/** 新建 / 编辑自动回复共用的表单载荷：编辑时省略 matchType */
export type ChannelAutoReplyValues = Partial<NonNullable<BodyOf<typeof channelContract.createAutoReply>>>;

/** 新建 / 编辑群发模板共用的表单载荷 */
export type ChannelTemplateValues = Partial<NonNullable<BodyOf<typeof channelMessageContract.createTemplate>>>;

const KEY = resourceKeyOf(channelContract.basePath);

/**
 * 子资源缓存按频道 ID 分段（`[KEY, 'messages', channelId, params]`），
 * 删除频道时才能按前缀整体移除该频道的消息 / 订阅者缓存。
 */
const subKeys = {
  menus: (channelId: number | undefined) => [KEY, 'menus', channelId] as const,
  autoReplies: (channelId: number | undefined) => [KEY, 'auto-replies', channelId] as const,
  /** 全部频道的消息（消息类接口只带 messageId，无法定位所属频道时用） */
  messagesAll: [KEY, 'messages'] as const,
  channelMessages: (channelId: number | undefined) => [KEY, 'messages', channelId] as const,
  messages: (channelId: number | undefined, params: ChannelMessagesParams) => [KEY, 'messages', channelId, params] as const,
  /** 指定频道的全部订阅者分页 */
  channelSubscribers: (channelId: number | undefined) => [KEY, 'subscribers', channelId] as const,
  subscribers: (channelId: number | undefined, params: ChannelSubscribersParams) => [KEY, 'subscribers', channelId, params] as const,
  templates: [KEY, 'templates'] as const,
};

const {
  keys: crudKeys,
  useList: useChannelList,
  useSave: useSaveChannel,
  useDelete: useDeleteChannel,
} = createResourceQueries(channelContract, {
  // 本域没有频道详情查询，列表即唯一展示面；删除后其菜单 / 自动回复 / 消息 / 订阅者缓存都不再有对应资源
  onDeleted: (qc, ids) => {
    for (const id of ids) {
      qc.removeQueries({ queryKey: subKeys.menus(id) });
      qc.removeQueries({ queryKey: subKeys.autoReplies(id) });
      qc.removeQueries({ queryKey: subKeys.channelMessages(id) });
      qc.removeQueries({ queryKey: subKeys.channelSubscribers(id) });
    }
  },
});

export const channelKeys = { ...crudKeys, ...subKeys };

export { useChannelList, useSaveChannel, useDeleteChannel };

const silent = { silent: true } as const;

export function useChannelMenus(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: channelKeys.menus(channelId),
    queryFn: () => api(channelContract.menus, { params: { id: channelId ?? 0 } }, silent),
    enabled: enabled && channelId !== undefined,
  });
}

export function useChannelAutoReplies(channelId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: channelKeys.autoReplies(channelId),
    queryFn: () => api(channelContract.autoReplies, { params: { id: channelId ?? 0 } }, silent),
    enabled: enabled && channelId !== undefined,
  });
}

export function useChannelMessages(channelId: number | undefined, params: ChannelMessagesParams, enabled = true) {
  return useQuery({
    queryKey: channelKeys.messages(channelId, params),
    queryFn: () => api(channelMessageContract.adminMessages, { params: { id: channelId ?? 0 }, query: params }, silent),
    enabled: enabled && channelId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useChannelSubscribers(channelId: number | undefined, params: ChannelSubscribersParams, enabled = true) {
  return useQuery({
    queryKey: channelKeys.subscribers(channelId, params),
    queryFn: () => api(channelContract.subscribers, { params: { id: channelId ?? 0 }, query: params }, silent),
    enabled: enabled && channelId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useChannelTemplates(enabled = true) {
  return useQuery({
    queryKey: channelKeys.templates,
    queryFn: () => api(channelMessageContract.templates, silent),
    enabled,
  });
}

/** 菜单不出现在频道列表（列表只有 subscriberCount / messageCount），故只动菜单自身 */
export function useSaveChannelMenus() {
  return useApiMutation(channelContract.saveMenus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.menus(params.id) });
    },
  });
}

export function useSaveChannelAutoReply() {
  const qc = useQueryClient();
  return useMutation<ChannelAutoReply, Error, { channelId: number; id?: number; values: ChannelAutoReplyValues }>({
    mutationFn: ({ channelId, id, values }) =>
      id === undefined
        ? api(channelContract.createAutoReply, { params: { id: channelId }, body: values as BodyOf<typeof channelContract.createAutoReply> })
        : api(channelContract.updateAutoReply, { params: { channelId, replyId: id }, body: values }),
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: channelKeys.autoReplies(variables.channelId) }),
  });
}

export function useDeleteChannelAutoReply() {
  return useApiMutation(channelContract.removeAutoReply, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.autoReplies(params.channelId) });
    },
  });
}

/** 群发 / 编辑草稿：消息记录与列表的 messageCount 一起刷新 */
export function usePublishChannelMessage() {
  const qc = useQueryClient();
  return useMutation<ChannelMessage, Error, { channelId: number; id?: number; values: ChannelPublishValues }>({
    mutationFn: ({ channelId, id, values }) =>
      id === undefined
        ? api(channelMessageContract.publish, { params: { id: channelId }, body: values })
        : api(channelMessageContract.updateDraft, { params: { id }, body: values }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: channelKeys.channelMessages(variables.channelId) });
      void qc.invalidateQueries({ queryKey: channelKeys.lists });
    },
  });
}

/**
 * 消息类接口只给消息 id，定位不到所属频道，退一步失效全部频道的消息列表；
 * 仍远小于 `.all`（不会波及菜单、自动回复、订阅者、模板）
 */
function invalidateChannelMessages(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: channelKeys.messagesAll });
  void qc.invalidateQueries({ queryKey: channelKeys.lists });
}

export function useDeleteChannelMessage() {
  return useApiMutation(channelMessageContract.removeDraft, { invalidate: invalidateChannelMessages });
}

export function usePublishChannelMessageNow() {
  return useApiMutation(channelMessageContract.publishDraftNow, { invalidate: invalidateChannelMessages });
}

export function useRetractChannelMessage() {
  return useApiMutation(channelMessageContract.retract, { invalidate: invalidateChannelMessages });
}

/** 测试发送只投递给本人，不产生频道消息记录，无需失效 */
export function useTestSendChannelMessage() {
  return useApiMutation(channelMessageContract.testSend);
}

export function useAudienceEstimate() {
  return useApiMutation(channelMessageContract.audienceEstimate, { requestOptions: silent });
}

export function useSaveChannelTemplate() {
  const qc = useQueryClient();
  return useMutation<ChannelMessageTemplate, Error, { id?: number; values: ChannelTemplateValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(channelMessageContract.createTemplate, { body: values as BodyOf<typeof channelMessageContract.createTemplate> })
        : api(channelMessageContract.updateTemplate, { params: { id }, body: values }),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelKeys.templates }),
  });
}

export function useDeleteChannelTemplate() {
  return useApiMutation(channelMessageContract.removeTemplate, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: channelKeys.templates });
    },
  });
}

/** 订阅者变更同时改变列表的 subscriberCount */
export function useAddChannelSubscribers() {
  return useApiMutation(channelContract.addSubscribers, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.channelSubscribers(params.id) });
      void qc.invalidateQueries({ queryKey: channelKeys.lists });
    },
  });
}

export function useRemoveChannelSubscriber() {
  return useApiMutation(channelContract.removeSubscriber, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.channelSubscribers(params.id) });
      void qc.invalidateQueries({ queryKey: channelKeys.lists });
    },
  });
}
