/**
 * 通知偏好（个人中心）域 hooks。
 *
 * 矩阵与全局设置是两棵独立缓存：调偏好开关不影响免打扰设置，反之亦然，
 * 因此互不失效；保存设置的写接口与查询同源（同一 service 映射），允许回填。
 */
import { notificationPreferenceContract } from '@zenith/shared/messaging';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const notificationPreferenceKeys = {
  matrix: contractKey(notificationPreferenceContract.matrix),
  settings: contractKey(notificationPreferenceContract.settings),
};

export function useNotificationMatrix() {
  return useApiQuery(notificationPreferenceContract.matrix);
}

export function useNotificationSettings() {
  return useApiQuery(notificationPreferenceContract.settings);
}

/** 保存偏好开关：服务端按稀疏规则落库，矩阵需回源重算生效值 */
export function useSaveNotificationPreferences() {
  return useApiMutation(notificationPreferenceContract.saveMatrix, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: notificationPreferenceKeys.matrix });
    },
  });
}

/** 保存全局设置：写接口返回与 GET 同源的完整设置，直接回填 */
export function useSaveNotificationSettings() {
  return useApiMutation(notificationPreferenceContract.saveSettings, {
    invalidate: (qc, saved) => {
      qc.setQueryData(notificationPreferenceKeys.settings, saved);
    },
  });
}