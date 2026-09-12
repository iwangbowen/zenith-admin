import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { inAppMessageContract, inAppTemplateContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type InAppMessageListParams = NonNullable<QueryOf<typeof inAppMessageContract.adminList>>;

/** 发送站内信的请求体（客户端视角，带默认值的字段可省略） */
export type SendInAppValues = NonNullable<BodyOf<typeof inAppMessageContract.send>>;

/** 顶栏铃铛固定取我的站内信首页 10 条 */
const MINE_QUERY = { page: 1, pageSize: 10 } as const;

/** 发送弹窗的模板下拉源：启用模板取前 100 条 */
const ENABLED_TEMPLATES_QUERY = { page: 1, pageSize: 100, status: 'enabled' } as const;

const silent = { silent: true } as const;

export const inAppMessageKeys = {
  lists: contractKey(inAppMessageContract.adminList),
  list: (params: InAppMessageListParams) => contractKey(inAppMessageContract.adminList, { query: params }),
  /** 我的全部站内信列表查询（顶栏铃铛 + 收件箱页的任意分页 / 筛选，同一 `list` 操作） */
  myLists: contractKey(inAppMessageContract.list),
  /** 顶栏铃铛里的我的站内信（固定首页 10 条） */
  mine: contractKey(inAppMessageContract.list, { query: MINE_QUERY }),
  /** 顶栏铃铛未读数 */
  myUnreadCount: contractKey(inAppMessageContract.unreadCount),
  /** 发送站内信弹窗的启用模板下拉源（归 in-app-templates 契约所有，随其列表前缀一起失效） */
  enabledTemplates: contractKey(inAppTemplateContract.list, { query: ENABLED_TEMPLATES_QUERY }),
};

/** 我的站内信（顶栏铃铛列表）；缓存里是分页载荷，select 只取列表（WebSocket 回执按分页形状写入） */
export function useMyInAppMessages() {
  return useApiQuery(inAppMessageContract.list, { query: MINE_QUERY }, {
    requestOptions: silent,
    select: (data) => data?.list ?? [],
  });
}

/** 我的站内信未读数 */
export function useMyInAppMessageUnreadCount() {
  return useApiQuery(inAppMessageContract.unreadCount, {
    requestOptions: silent,
    select: (data) => data?.count ?? 0,
  });
}

/** 标记我的某条站内信已读（区别于管理端的 adminMarkRead）；铃铛缓存由 WebSocket 回执写入 */
export function useMarkMyInAppMessageRead() {
  return useApiMutation(inAppMessageContract.markRead, { requestOptions: silent });
}

export function useInAppMessageList(params: InAppMessageListParams) {
  return useApiQuery(inAppMessageContract.adminList, { query: params }, { placeholderData: keepPreviousData });
}

/**
 * 管理端写操作（发送 / 标已读 / 删除）同时改变收件记录列表与本人视角的站内信（铃铛列表、未读数、收件箱页）；
 * 模板下拉源不受影响，故不再整域广播。收件箱详情由收件箱页持有，未挂载时仅标脏。
 */
function invalidateAfterAdminWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.lists });
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.myLists });
  void qc.invalidateQueries({ queryKey: inAppMessageKeys.myUnreadCount });
  void qc.invalidateQueries({ queryKey: contractKey(inAppMessageContract.detail) });
}

export function useSendInAppMessage() {
  return useApiMutation(inAppMessageContract.send, { invalidate: invalidateAfterAdminWrite });
}

export function useMarkInAppMessageRead() {
  return useApiMutation(inAppMessageContract.adminMarkRead, { invalidate: invalidateAfterAdminWrite });
}

export function useMarkAllInAppMessagesRead() {
  return useApiMutation(inAppMessageContract.adminMarkAllRead, { invalidate: invalidateAfterAdminWrite });
}

/** 被删记录的收件箱详情移除而非失效，其余同管理端写操作 */
export function useDeleteInAppMessage() {
  return useApiMutation(inAppMessageContract.adminRemove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: contractKey(inAppMessageContract.detail, { params }) });
      invalidateAfterAdminWrite(qc);
    },
  });
}

export function useEnabledInAppTemplates(enabled = true) {
  return useApiQuery(inAppTemplateContract.list, { query: ENABLED_TEMPLATES_QUERY }, { enabled });
}
