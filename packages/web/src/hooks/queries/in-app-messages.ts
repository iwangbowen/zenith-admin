import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { inAppMessageContract, inAppTemplateContract } from '@zenith/shared/messaging';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type InAppMessageListParams = NonNullable<QueryOf<typeof inAppMessageContract.adminList>>;

/** 发送站内信的请求体（客户端视角，带默认值的字段可省略） */
export type SendInAppValues = NonNullable<BodyOf<typeof inAppMessageContract.send>>;

const KEY = resourceKeyOf(inAppMessageContract.basePath);

export const inAppMessageKeys = {
  all: [KEY] as const,
  lists: contractKey(inAppMessageContract.adminList),
  list: (params: InAppMessageListParams) => contractKey(inAppMessageContract.adminList, { query: params }),
  /** 顶栏铃铛里的我的站内信（固定首页 10 条） */
  mine: [KEY, 'mine'] as const,
  /** 顶栏铃铛未读数 */
  myUnreadCount: [KEY, 'mine', 'unread-count'] as const,
  /** 发送站内信弹窗的启用模板下拉源 */
  enabledTemplates: [KEY, 'enabled-templates'] as const,
};

/** 我的站内信（顶栏铃铛列表） */
export function useMyInAppMessages() {
  return useQuery({
    queryKey: inAppMessageKeys.mine,
    queryFn: () => api(inAppMessageContract.list, { query: { page: 1, pageSize: 10 } }, { silent: true }),
    select: (data) => data?.list ?? [],
  });
}

/** 我的站内信未读数 */
export function useMyInAppMessageUnreadCount() {
  return useQuery({
    queryKey: inAppMessageKeys.myUnreadCount,
    queryFn: () => api(inAppMessageContract.unreadCount, { silent: true }),
    select: (data) => data?.count ?? 0,
  });
}

/** 标记我的某条站内信已读（区别于管理端的 adminMarkRead）；铃铛缓存由 WebSocket 回执写入 */
export function useMarkMyInAppMessageRead() {
  return useApiMutation(inAppMessageContract.markRead, { requestOptions: { silent: true } });
}

export function useInAppMessageList(params: InAppMessageListParams) {
  return useApiQuery(inAppMessageContract.adminList, { query: params }, { placeholderData: keepPreviousData });
}

/** 管理端写操作同时改变收件记录列表与本人铃铛，整个域一起失效 */
function invalidateAll(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.all });
}

export function useSendInAppMessage() {
  return useApiMutation(inAppMessageContract.send, { invalidate: invalidateAll });
}

export function useMarkInAppMessageRead() {
  return useApiMutation(inAppMessageContract.adminMarkRead, { invalidate: invalidateAll });
}

export function useMarkAllInAppMessagesRead() {
  return useApiMutation(inAppMessageContract.adminMarkAllRead, { invalidate: invalidateAll });
}

export function useDeleteInAppMessage() {
  return useApiMutation(inAppMessageContract.adminRemove, { invalidate: invalidateAll });
}

export function useEnabledInAppTemplates(enabled = true) {
  return useQuery({
    queryKey: inAppMessageKeys.enabledTemplates,
    queryFn: () => api(inAppTemplateContract.list, { query: { page: 1, pageSize: 100, status: 'enabled' } }),
    enabled,
  });
}