import type { QueryOf } from '@zenith/shared/core';
import { reportDeliveryRunContract, reportSubscriptionContract } from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { asyncTaskKeys } from './async-tasks';
import { useReportLookup } from './report-lookups';

export type ReportSubscriptionListParams = NonNullable<QueryOf<typeof reportSubscriptionContract.list>>;

/** 订阅的投递历史（投递记录契约按目标筛选） */
const historyQuery = (id: number) => ({
  targetType: 'subscription' as const,
  subscriptionId: id,
  includeAttempts: true,
  page: 1,
  pageSize: 20,
});

const resource = createResourceQueries(reportSubscriptionContract, {
  // 投递历史随订阅增删一并失效
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.history() }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.history() }),
});

export const reportSubscriptionKeys = {
  ...resource.keys,
  history: (id?: number) => id === undefined
    ? contractKey(reportDeliveryRunContract.list)
    : contractKey(reportDeliveryRunContract.list, { query: historyQuery(id) }),
};

export const useReportSubscriptionList = resource.useList;
export const useSaveReportSubscription = resource.useSave;
export const useDeleteReportSubscriptions = resource.useDelete;

export function useReportSubscriptionDashboardOptions() {
  return useReportLookup('dashboards', { status: 'enabled', limit: 50 });
}

/**
 * 立即推送是异步任务：立刻可见的是任务中心多了一条记录；lastRunAt / 最近投递状态与新的投递记录由 worker 回写，
 * 把订阅列表与该订阅的投递历史标脏（页面另有延时刷新兜底）。详情 / 其它订阅的历史不受影响。
 */
export function useRunReportSubscription() {
  return useApiMutation(reportSubscriptionContract.run, {
    invalidate: (qc, _task, { params }) => {
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
      void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.lists });
      void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.history(params.id) });
    },
  });
}

/** 批量启停只改若干订阅的 enabled：列表与各自详情回源，投递历史不变 */
export function useBatchReportSubscriptionEnabled() {
  return useApiMutation(reportSubscriptionContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.lists });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.detail(id) });
    },
  });
}

export function useReportSubscriptionHistory(id: number | undefined, enabled = true) {
  return useApiQuery(reportDeliveryRunContract.list, { query: historyQuery(id ?? 0) }, { enabled: enabled && !!id });
}
