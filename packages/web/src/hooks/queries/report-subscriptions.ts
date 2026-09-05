import type { QueryOf } from '@zenith/shared/core';
import { reportDeliveryRunContract, reportSubscriptionContract } from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
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

export function useRunReportSubscription() {
  return useApiMutation(reportSubscriptionContract.run, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all });
      void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.history() });
    },
  });
}

export function useBatchReportSubscriptionEnabled() {
  return useApiMutation(reportSubscriptionContract.batchStatus, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all }),
  });
}

export function useReportSubscriptionHistory(id: number | undefined, enabled = true) {
  return useApiQuery(reportDeliveryRunContract.list, { query: historyQuery(id ?? 0) }, { enabled: enabled && !!id });
}
