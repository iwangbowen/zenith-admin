import { keepPreviousData } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { asyncTaskContract } from '@zenith/shared/tasks';
import type { AsyncTaskItemStatus } from '@zenith/shared/tasks';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateEntityRelations } from '@/lib/entity-relation-cache';

export type AsyncTaskListParams = NonNullable<QueryOf<typeof asyncTaskContract.list>>;

export type AsyncTaskItemsParams = { taskId: number } & NonNullable<QueryOf<typeof asyncTaskContract.items>>;

export const asyncTaskKeys = {
  all: [resourceKeyOf(asyncTaskContract.basePath)] as const,
  lists: contractKey(asyncTaskContract.list),
  list: (params: AsyncTaskListParams) => contractKey(asyncTaskContract.list, { query: params }),
  stats: contractKey(asyncTaskContract.stats),
  types: contractKey(asyncTaskContract.types),
  items: contractKey(asyncTaskContract.items),
  itemList: ({ taskId, ...query }: AsyncTaskItemsParams) => contractKey(asyncTaskContract.items, { params: { id: taskId }, query }),
  detail: (id: number) => contractKey(asyncTaskContract.detail, { params: { id } }),
};

export function useAsyncTaskList(params: AsyncTaskListParams, options?: { refetchInterval?: number | false }) {
  return useApiQuery(asyncTaskContract.list, { query: params }, {
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  });
}

export function useAsyncTaskDetail(id: number | undefined, enabled = true) {
  return useApiQuery(asyncTaskContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    requestOptions: { silent: true },
  });
}

export function useAsyncTaskStats(options?: { refetchInterval?: number | false }) {
  return useApiQuery(asyncTaskContract.stats, {
    refetchInterval: options?.refetchInterval,
    requestOptions: { silent: true },
  });
}

export function useAsyncTaskTypes() {
  return useApiQuery(asyncTaskContract.types, { requestOptions: { silent: true } });
}

export function useAsyncTaskItems({ taskId, ...query }: AsyncTaskItemsParams, enabled = true) {
  return useApiQuery(asyncTaskContract.items, { params: { id: taskId }, query }, {
    enabled,
    placeholderData: keepPreviousData,
    requestOptions: { silent: true },
  });
}

/**
 * 任务状态变更（取消 / 恢复 / 重启 / 删除 / 批量 / 清理）的公共失效面。
 *
 * 覆盖列表、统计与明细项，但**不含 `types`**：任务类型元数据由
 * `useUpdateAsyncTaskTypeConfig` 单独维护，不随任务状态变化。
 * 任务中心一屏同时挂着 list / stats / types / items，用 `.all` 会连带把 types 打回源。
 *
 * 导出供 `biz-pay-demo.ts` 复用——任务演示页打的是同一批任务中心端点，
 * 刻意共享同一命名空间以复用缓存，失效语义也必须跟着一致。
 */
export function invalidateAsyncTaskState(qc: QueryClient) {
  void invalidateEntityRelations(qc);
  void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
  void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
  void qc.invalidateQueries({ queryKey: asyncTaskKeys.items });
}

const TASK_ACTIONS = {
  cancel: asyncTaskContract.cancel,
  resume: asyncTaskContract.resume,
  restart: asyncTaskContract.restart,
} as const;

export function useAsyncTaskAction(action: keyof typeof TASK_ACTIONS) {
  return useApiMutation(TASK_ACTIONS[action], { invalidate: invalidateAsyncTaskState });
}

export function useDeleteAsyncTask() {
  return useApiMutation(asyncTaskContract.remove, { invalidate: invalidateAsyncTaskState });
}

export function useBatchCancelAsyncTasks() {
  return useApiMutation(asyncTaskContract.batchCancel, { invalidate: invalidateAsyncTaskState });
}

export function useBatchDeleteAsyncTasks() {
  return useApiMutation(asyncTaskContract.batchDelete, { invalidate: invalidateAsyncTaskState });
}

export function useCleanupAsyncTasks() {
  return useApiMutation(asyncTaskContract.cleanup, { invalidate: invalidateAsyncTaskState });
}

export function useUpdateAsyncTaskTypeConfig() {
  return useApiMutation(asyncTaskContract.updateTypePolicy, {
    // 只改类型配置；已产生的任务实例与统计不受影响
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: asyncTaskKeys.types }),
  });
}

export type { AsyncTaskItemStatus };
