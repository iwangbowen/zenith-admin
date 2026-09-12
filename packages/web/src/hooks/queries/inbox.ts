import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { inAppMessageContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { inAppMessageKeys } from '@/hooks/queries/in-app-messages';

export type InboxListParams = NonNullable<QueryOf<typeof inAppMessageContract.list>>;

/**
 * 收件箱页与顶栏铃铛读的是同一个 `list` 操作，key 由契约派生后天然同源：
 * `lists` 前缀同时覆盖收件箱任意分页与铃铛的首页 10 条。
 */
export const inboxKeys = {
  lists: contractKey(inAppMessageContract.list),
  list: (params: InboxListParams) => contractKey(inAppMessageContract.list, { query: params }),
  /** 全部站内信详情 */
  details: contractKey(inAppMessageContract.detail),
  detail: (id: number | undefined) => contractKey(inAppMessageContract.detail, { params: { id: id ?? 0 } }),
};

export function useInboxList(params: InboxListParams) {
  return useApiQuery(inAppMessageContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useInboxMessageDetail(id: number | undefined, enabled = true) {
  return useApiQuery(inAppMessageContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 已读会改变列表行与详情的 isRead、顶栏未读数；铃铛列表与收件箱列表同一操作，由 `lists` 一并覆盖 */
function invalidateInboxAndBell(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: inboxKeys.lists });
  void qc.invalidateQueries({ queryKey: inboxKeys.details });
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.myUnreadCount });
}

/** 删除：被删记录的详情移除而非失效（失效会去请求一个必然 404 的资源），其余同已读 */
function removeInboxMessages(qc: QueryClient, ids: number[]) {
  for (const id of ids) qc.removeQueries({ queryKey: inboxKeys.detail(id) });
  void qc.invalidateQueries({ queryKey: inboxKeys.lists });
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.myUnreadCount });
}

export function useMarkInboxMessageRead() {
  return useApiMutation(inAppMessageContract.markRead, { requestOptions: { silent: true }, invalidate: invalidateInboxAndBell });
}

export function useMarkAllInboxMessagesRead() {
  return useApiMutation(inAppMessageContract.markAllRead, { invalidate: invalidateInboxAndBell });
}

export function useBatchMarkInboxMessagesRead() {
  return useApiMutation(inAppMessageContract.markReadBatch, { invalidate: invalidateInboxAndBell });
}

export function useBatchDeleteInboxMessages() {
  return useApiMutation(inAppMessageContract.removeBatch, {
    invalidate: (qc, _output, { body }) => removeInboxMessages(qc, body.ids),
  });
}

export function useDeleteInboxMessage() {
  return useApiMutation(inAppMessageContract.remove, {
    invalidate: (qc, _output, { params }) => removeInboxMessages(qc, [params.id]),
  });
}
