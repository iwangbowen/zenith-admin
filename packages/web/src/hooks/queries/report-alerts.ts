import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { reportAlertContract, reportDeliveryRunContract } from '@zenith/shared/report';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type ReportAlertListParams = NonNullable<QueryOf<typeof reportAlertContract.list>>;

/** 预警的投递历史（投递记录契约按目标筛选） */
const historyQuery = (id: number) => ({
  targetType: 'alert' as const,
  alertRuleId: id,
  includeAttempts: true,
  page: 1,
  pageSize: 20,
});

const resource = createResourceQueries(reportAlertContract, {
  requestOptions: { silent: true },
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: reportAlertKeys.history() }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: reportAlertKeys.history() }),
});

export const reportAlertKeys = {
  ...resource.keys,
  history: (id?: number) => id === undefined
    ? contractKey(reportDeliveryRunContract.list)
    : contractKey(reportDeliveryRunContract.list, { query: historyQuery(id) }),
};

/** 预警规则的任何变更都会改写列表上的状态列与最近投递结果，整域失效 */
function invalidateAlerts(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: reportAlertKeys.all });
  void qc.invalidateQueries({ queryKey: reportAlertKeys.history() });
}

export function useReportAlertList(params: ReportAlertListParams) {
  return useApiQuery(reportAlertContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export const useSaveReportAlert = resource.useSave;
export const useDeleteReportAlerts = resource.useDelete;

export function useToggleReportAlertEnabled() {
  return useApiMutation(reportAlertContract.update, { requestOptions: { silent: true }, invalidate: invalidateAlerts });
}

export function useEvaluateReportAlert() {
  return useApiMutation(reportAlertContract.evaluate, { requestOptions: { silent: true }, invalidate: invalidateAlerts });
}

export function useBatchReportAlertEnabled() {
  return useApiMutation(reportAlertContract.batchStatus, { requestOptions: { silent: true }, invalidate: invalidateAlerts });
}

export function useReportAlertHistory(id: number | undefined, enabled = true) {
  return useApiQuery(reportDeliveryRunContract.list, { query: historyQuery(id ?? 0) }, { enabled: enabled && !!id });
}

export function useAcknowledgeReportAlertRun() {
  return useApiMutation(reportDeliveryRunContract.acknowledge, { requestOptions: { silent: true }, invalidate: invalidateAlerts });
}
