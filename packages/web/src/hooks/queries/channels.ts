import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { AnyOperation, BodyOf, InputOf, QueryOf } from '@zenith/shared/core';
import { channelContract, channelMessageContract } from '@zenith/shared/messaging';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery, useSaveMutation } from '@/lib/contract-query';

export type ChannelListParams = NonNullable<QueryOf<typeof channelContract.list>>;

export type ChannelMessagesParams = NonNullable<QueryOf<typeof channelMessageContract.adminMessages>>;

export type ChannelSubscribersParams = NonNullable<QueryOf<typeof channelContract.subscribers>>;

/** 群发 / 编辑草稿共用的请求体（`publishChannelSchema`） */
export type ChannelPublishValues = NonNullable<BodyOf<typeof channelMessageContract.publish>>;

/** 新建自动回复的请求体 */
export type ChannelAutoReplyCreateValues = NonNullable<BodyOf<typeof channelContract.createAutoReply>>;

/** 编辑自动回复的请求体（省略 matchType） */
export type ChannelAutoReplyUpdateValues = NonNullable<BodyOf<typeof channelContract.updateAutoReply>>;

/** 新建 / 编辑群发模板共用的表单载荷 */
export type ChannelTemplateValues = Partial<NonNullable<BodyOf<typeof channelMessageContract.createTemplate>>>;

/**
 * 子资源 key 全部由契约操作派生。「某频道的全部消息 / 订阅者分页」这类前缀用 `query: {}` 表达：
 * TanStack 对对象段做深部分匹配，空对象命中任意分页 / 筛选条件，删除频道时才能按前缀整体移除。
 */
const subKeys = {
  menus: (channelId: number | undefined) => contractKey(channelContract.menus, { params: { id: channelId ?? 0 } }),
  autoReplies: (channelId: number | undefined) => contractKey(channelContract.autoReplies, { params: { id: channelId ?? 0 } }),
  channelMessages: (channelId: number | undefined) =>
    contractKey(channelMessageContract.adminMessages, { params: { id: channelId ?? 0 }, query: {} }),
  messages: (channelId: number | undefined, params: ChannelMessagesParams) =>
    contractKey(channelMessageContract.adminMessages, { params: { id: channelId ?? 0 }, query: params }),
  /** 指定频道的全部订阅者分页 */
  channelSubscribers: (channelId: number | undefined) =>
    contractKey(channelContract.subscribers, { params: { id: channelId ?? 0 }, query: {} }),
  subscribers: (channelId: number | undefined, params: ChannelSubscribersParams) =>
    contractKey(channelContract.subscribers, { params: { id: channelId ?? 0 }, query: params }),
  templates: contractKey(channelMessageContract.templates),
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

/**
 * 频道底部菜单：管理端菜单编辑器与聊天页频道视图共用同一缓存 key，
 * `useSaveChannelMenus` 保存后两侧同时刷新。聊天侧菜单变动极少，可传 `staleTime` 减少重复拉取。
 */
export function useChannelMenus(channelId: number | undefined, enabled = true, options?: { staleTime?: number }) {
  return useApiQuery(channelContract.menus, { params: { id: channelId ?? 0 } }, {
    enabled: enabled && channelId !== undefined,
    staleTime: options?.staleTime,
    requestOptions: silent,
  });
}

export function useChannelAutoReplies(channelId: number | undefined, enabled = true) {
  return useApiQuery(channelContract.autoReplies, { params: { id: channelId ?? 0 } }, {
    enabled: enabled && channelId !== undefined,
    requestOptions: silent,
  });
}

export function useChannelMessages(channelId: number | undefined, params: ChannelMessagesParams, enabled = true) {
  return useApiQuery(channelMessageContract.adminMessages, { params: { id: channelId ?? 0 }, query: params }, {
    enabled: enabled && channelId !== undefined,
    placeholderData: keepPreviousData,
    requestOptions: silent,
  });
}

export function useChannelSubscribers(channelId: number | undefined, params: ChannelSubscribersParams, enabled = true) {
  return useApiQuery(channelContract.subscribers, { params: { id: channelId ?? 0 }, query: params }, {
    enabled: enabled && channelId !== undefined,
    placeholderData: keepPreviousData,
    requestOptions: silent,
  });
}

export function useChannelTemplates(enabled = true) {
  return useApiQuery(channelMessageContract.templates, { enabled, requestOptions: silent });
}

/** 菜单不出现在频道列表（列表只有 subscriberCount / messageCount），故只动菜单自身 */
export function useSaveChannelMenus() {
  return useApiMutation(channelContract.saveMenus, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.menus(params.id) });
    },
  });
}

/**
 * 自动回复的新建 / 编辑带父级路径参数（channelId），`useSaveMutation` 只认 `id`，
 * 故拆成两个契约 mutation；两者都只影响该频道的自动回复列表。
 */
export function useCreateChannelAutoReply() {
  return useApiMutation(channelContract.createAutoReply, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.autoReplies(params.id) });
    },
  });
}

export function useUpdateChannelAutoReply() {
  return useApiMutation(channelContract.updateAutoReply, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.autoReplies(params.channelId) });
    },
  });
}

export function useDeleteChannelAutoReply() {
  return useApiMutation(channelContract.removeAutoReply, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: channelKeys.autoReplies(params.channelId) });
    },
  });
}

/** 消息记录与列表的 messageCount 一起刷新 */
function invalidateChannelMessagesOf(qc: QueryClient, channelId: number) {
  void qc.invalidateQueries({ queryKey: channelKeys.channelMessages(channelId) });
  void qc.invalidateQueries({ queryKey: channelKeys.lists });
}

/** 群发（含存草稿 / 定时）：路径参数是频道 id */
export function usePublishChannelMessage() {
  return useApiMutation(channelMessageContract.publish, {
    invalidate: (qc, _output, { params }) => invalidateChannelMessagesOf(qc, params.id),
  });
}

/** 编辑草稿 / 定时消息：路径参数是消息 id，所属频道取自响应 */
export function useUpdateChannelDraft() {
  return useApiMutation(channelMessageContract.updateDraft, {
    invalidate: (qc, saved) => invalidateChannelMessagesOf(qc, saved.channelId),
  });
}

/**
 * 空响应的消息动作（删除草稿 / 撤回）：契约输入只有消息 id，定位不到所属频道，
 * 调用方额外传 `channelId`（消息行自带）供精确失效；该字段只进 `invalidate`，不参与请求。
 */
type ChannelMessageActionVariables<Op extends AnyOperation> = InputOf<Op> & { channelId: number };

export function useDeleteChannelMessage() {
  return useApiMutation<typeof channelMessageContract.removeDraft, ChannelMessageActionVariables<typeof channelMessageContract.removeDraft>>(
    channelMessageContract.removeDraft,
    { invalidate: (qc, _output, { channelId }) => invalidateChannelMessagesOf(qc, channelId) },
  );
}

/** 立即发送草稿：响应带 channelId */
export function usePublishChannelMessageNow() {
  return useApiMutation(channelMessageContract.publishDraftNow, {
    invalidate: (qc, saved) => invalidateChannelMessagesOf(qc, saved.channelId),
  });
}

export function useRetractChannelMessage() {
  return useApiMutation<typeof channelMessageContract.retract, ChannelMessageActionVariables<typeof channelMessageContract.retract>>(
    channelMessageContract.retract,
    { invalidate: (qc, _output, { channelId }) => invalidateChannelMessagesOf(qc, channelId) },
  );
}

/** 测试发送只投递给本人，不产生频道消息记录，无需失效 */
export function useTestSendChannelMessage() {
  return useApiMutation(channelMessageContract.testSend);
}

export function useAudienceEstimate() {
  return useApiMutation(channelMessageContract.audienceEstimate, { requestOptions: silent });
}

export function useSaveChannelTemplate() {
  return useSaveMutation(channelMessageContract.createTemplate, channelMessageContract.updateTemplate, {
    invalidate: (qc) => qc.invalidateQueries({ queryKey: channelKeys.templates }),
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
