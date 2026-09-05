/**
 * App 推送域 hooks（配置 / 发送记录）。
 *
 * key 结构：push-configs 与 push-send-logs 两个独立命名空间；
 * 测试发送会产生发送记录 → 连带失效记录域（通常另页未挂载，失效零成本）。
 */
import type { QueryOf } from '@zenith/shared/core';
import { pushConfigContract, pushSendLogContract } from '@zenith/shared/messaging';
import { createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const {
  keys: pushConfigKeys,
  useList: usePushConfigList,
  useDetail: usePushConfigDetail,
  useSave: useSavePushConfig,
  useDelete: useDeletePushConfigs,
} = createResourceQueries(pushConfigContract);

export type PushSendLogListParams = NonNullable<QueryOf<typeof pushSendLogContract.list>>;

export const {
  keys: pushSendLogKeys,
  useList: usePushSendLogList,
} = createResourceQueries(pushSendLogContract);

/** 测试发送：产生一条发送记录 → 失效记录域（列表 + 统计）；配置本身不变 */
export function useTestPushSend() {
  return useApiMutation(pushConfigContract.testSend, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: pushSendLogKeys.all });
    },
  });
}

/** 记录页顶部统计（窗口汇总 + 趋势）；挂在记录域 key 下，测试发送后随列表一并失效 */
export function usePushSendLogStats(days: number) {
  return useApiQuery(pushSendLogContract.stats, { query: { days } });
}
