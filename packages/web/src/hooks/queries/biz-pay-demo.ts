import type { QueryClient } from '@tanstack/react-query';
import { bizPayDemoContract } from '@zenith/shared/biz';
import type { QueryOf } from '@zenith/shared/core';
import { taskDemoContract } from '@zenith/shared/tasks';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { invalidateAsyncTaskState, useAsyncTaskAction, useAsyncTaskItems, useAsyncTaskTypes } from './async-tasks';

export type BizPayDemoListParams = NonNullable<QueryOf<typeof bizPayDemoContract.list>>;

const resource = createResourceQueries(bizPayDemoContract);

export const bizPayDemoKeys = resource.keys;

/**
 * 任务演示打的是任务中心同一批端点（类型元数据、明细项、取消/恢复/重启），
 * 直接复用任务中心域 hooks 以共享缓存与失效语义，而不是另起 `['biz-task-demo']` 造成同一端点两份副本。
 */
export {
  useAsyncTaskAction as useBizTaskDemoAction,
  useAsyncTaskItems as useBizTaskDemoItems,
  useAsyncTaskTypes as useBizTaskDemoTypes,
};

export const useBizPayDemoList = resource.useList;
export const useBizPayDemoDetail = resource.useDetail;
export const useDeleteBizPayDemo = resource.useDelete;

/** 示例单只有新增没有编辑；列表与详情随创建 / 支付 / 模拟支付变化 */
function invalidateDemos(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: bizPayDemoKeys.all });
}

export function useCreateBizPayDemo() {
  return useApiMutation(bizPayDemoContract.create, { invalidate: invalidateDemos });
}

export function usePayBizPayDemo() {
  return useApiMutation(bizPayDemoContract.pay, { invalidate: invalidateDemos });
}

export function useSimulateBizPayDemoPaid() {
  return useApiMutation(bizPayDemoContract.simulatePaid, { invalidate: invalidateDemos });
}

export function useSubmitTaskDemo() {
  return useApiMutation(taskDemoContract.submit, { invalidate: invalidateAsyncTaskState });
}
