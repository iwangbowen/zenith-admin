import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { systemSchedulerContract } from '@zenith/shared/platform';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type SystemSchedulerRunListParams = NonNullable<QueryOf<typeof systemSchedulerContract.runs>>;

export type SystemSchedulerNodeListParams = NonNullable<QueryOf<typeof systemSchedulerContract.nodes>>;

export const systemSchedulerKeys = {
  tasks: contractKey(systemSchedulerContract.tasks),
  runs: contractKey(systemSchedulerContract.runs),
  runList: (params: SystemSchedulerRunListParams) => contractKey(systemSchedulerContract.runs, { query: params }),
  /** 全部运行日志详情的公共前缀 */
  runDetails: contractKey(systemSchedulerContract.runDetail),
  runDetail: (id: number) => contractKey(systemSchedulerContract.runDetail, { params: { id } }),
  nodes: contractKey(systemSchedulerContract.nodes),
  nodeList: (params: SystemSchedulerNodeListParams) => contractKey(systemSchedulerContract.nodes, { query: params }),
};

export function useSystemSchedulerTasks() {
  return useApiQuery(systemSchedulerContract.tasks);
}

export function useSystemSchedulerRuns(params: SystemSchedulerRunListParams, enabled = true) {
  return useApiQuery(systemSchedulerContract.runs, { query: params }, { enabled, placeholderData: keepPreviousData });
}

export function useSystemSchedulerRunDetail(id: number | undefined, enabled = true) {
  return useApiQuery(systemSchedulerContract.runDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useSystemSchedulerNodes(params: SystemSchedulerNodeListParams, enabled = true) {
  return useApiQuery(systemSchedulerContract.nodes, { query: params }, { enabled, placeholderData: keepPreviousData });
}

/** 手动执行新增一条运行日志并改写任务行的最近运行状态；节点清单是心跳数据，与此无关 */
export function invalidateSchedulerAfterRun(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: systemSchedulerKeys.tasks });
  void qc.invalidateQueries({ queryKey: systemSchedulerKeys.runs });
}

export function useRunSystemSchedulerTask() {
  return useApiMutation(systemSchedulerContract.runTask, { invalidate: invalidateSchedulerAfterRun });
}

/** 任务配置（启用 / 告警渠道 / 超时）只体现在任务行上，运行日志与节点不变 */
export function useSaveSystemSchedulerTaskConfig() {
  return useApiMutation(systemSchedulerContract.updateTaskConfig, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: systemSchedulerKeys.tasks }),
  });
}

/** 确认告警写在运行记录上（alertAck*），运行列表的告警筛选列、该条详情与任务行的 alertCount 都会变化 */
export function useAcknowledgeSystemSchedulerAlert() {
  return useApiMutation(systemSchedulerContract.acknowledgeAlert, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: systemSchedulerKeys.runs });
      void qc.invalidateQueries({ queryKey: systemSchedulerKeys.runDetail(params.id) });
      void qc.invalidateQueries({ queryKey: systemSchedulerKeys.tasks });
    },
  });
}

/** 清理历史运行日志：运行列表回源；被清理的记录无法逐条定位，未挂载的详情缓存直接移除（再打开会重新请求，不会 404 重拉） */
export function useCleanupSystemSchedulerRuns() {
  return useApiMutation(systemSchedulerContract.cleanupRuns, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: systemSchedulerKeys.runs });
      qc.removeQueries({ queryKey: systemSchedulerKeys.runDetails, type: 'inactive' });
    },
  });
}
