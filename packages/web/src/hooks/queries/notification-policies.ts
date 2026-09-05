/**
 * 通知策略（管理员）域 hooks。
 */
import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { notificationPolicyContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { notificationPreferenceKeys } from './notification-preferences';

export type NotificationDispatchListParams = NonNullable<QueryOf<typeof notificationPolicyContract.dispatches>>;

export const notificationPolicyKeys = {
  events: contractKey(notificationPolicyContract.events),
  dispatches: contractKey(notificationPolicyContract.dispatches),
  dispatchList: (params: NotificationDispatchListParams) => contractKey(notificationPolicyContract.dispatches, { query: params }),
};

export function useNotificationPolicyEvents() {
  return useApiQuery(notificationPolicyContract.events);
}

/** 保存 / 重置覆盖后，除策略目录外还要打掉个人矩阵——覆盖直接改变矩阵里的默认值与锁定态 */
function invalidatePolicyAffected(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: notificationPolicyKeys.events });
  void qc.invalidateQueries({ queryKey: notificationPreferenceKeys.matrix });
}

export function useSaveNotificationOverride() {
  return useApiMutation(notificationPolicyContract.saveOverride, { invalidate: invalidatePolicyAffected });
}

export function useResetNotificationOverride() {
  return useApiMutation(notificationPolicyContract.resetOverride, { invalidate: invalidatePolicyAffected });
}

export function useNotificationDispatches(params: NotificationDispatchListParams) {
  return useApiQuery(notificationPolicyContract.dispatches, { query: params }, { placeholderData: keepPreviousData });
}

/** 测试触发：真实派发一次事件给当前管理员 → 失效投递日志 */
export function useTestFireNotification() {
  return useApiMutation(notificationPolicyContract.testFire, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: notificationPolicyKeys.dispatches });
    },
  });
}