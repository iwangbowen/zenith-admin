/**
 * 运营群发域 hooks。
 *
 * key 结构：broadcasts 独立命名空间；发送动作改变活动状态并产生任务中心任务，
 * 成功后失效整个域（列表 + 详情）；任务进度经 useMyAsyncTasks 实时获取，不进本域缓存。
 */
import { broadcastContract } from '@zenith/shared/messaging';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';

export const {
  keys: broadcastKeys,
  useList: useBroadcastList,
  useDetail: useBroadcastDetail,
  useSave: useSaveBroadcast,
  useDelete: useDeleteBroadcasts,
} = createResourceQueries(broadcastContract);

/** 发送：活动置为 sending 并提交任务中心任务 → 失效整个群发域 */
export function useSendBroadcast() {
  return useApiMutation(broadcastContract.send, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: broadcastKeys.all });
    },
  });
}