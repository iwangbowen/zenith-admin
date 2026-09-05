import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { inAppMessageContract } from '@zenith/shared/messaging';
import { api, useApiMutation } from '@/lib/contract-query';
import { inAppMessageKeys } from '@/hooks/queries/in-app-messages';

export type InboxListParams = NonNullable<QueryOf<typeof inAppMessageContract.list>>;

/** 收件箱页自成一棵缓存子树，与顶栏铃铛（`in-app-messages` / mine）分开持有 */
export const inboxKeys = {
  all: ['inbox'] as const,
  lists: ['inbox', 'list'] as const,
  list: (params: InboxListParams) => ['inbox', 'list', params] as const,
  detail: (id: number | undefined) => ['inbox', 'detail', id] as const,
};

export function useInboxList(params: InboxListParams) {
  return useQuery({
    queryKey: inboxKeys.list(params),
    queryFn: () => api(inAppMessageContract.list, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useInboxMessageDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => api(inAppMessageContract.detail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

/** 已读 / 删除会同时改变收件箱列表与顶栏铃铛（列表 + 未读数），两处缓存一起失效 */
function invalidateInboxAndBell(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: inboxKeys.all });
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.mine });
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
  return useApiMutation(inAppMessageContract.removeBatch, { invalidate: invalidateInboxAndBell });
}

export function useDeleteInboxMessage() {
  return useApiMutation(inAppMessageContract.remove, { invalidate: invalidateInboxAndBell });
}