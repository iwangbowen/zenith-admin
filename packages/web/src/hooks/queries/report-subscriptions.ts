import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AsyncTask, PaginatedResponse, ReportDashboardSubscription, ReportDeliveryRun } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { useReportLookup } from './report-lookups';

export interface ReportSubscriptionListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const reportSubscriptionKeys = {
  all: ['report', 'subscriptions'] as const,
  lists: ['report', 'subscriptions', 'list'] as const,
  list: (params: ReportSubscriptionListParams) => ['report', 'subscriptions', 'list', params] as const,
  dashboardOptions: ['report', 'subscriptions', 'dashboard-options'] as const,
  history: (id: number | undefined) => ['report', 'subscriptions', 'history', id] as const,
};

export function useReportSubscriptionList(params: ReportSubscriptionListParams) {
  return useQuery({
    queryKey: reportSubscriptionKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportDashboardSubscription>>(`/api/report/subscriptions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useReportSubscriptionDashboardOptions() {
  return useReportLookup('dashboards', { status: 'enabled', limit: 50 });
}

export function useSaveReportSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<ReportDashboardSubscription>(`/api/report/subscriptions/${id}`, values) : request.post<ReportDashboardSubscription>('/api/report/subscriptions', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all }),
  });
}

export function useDeleteReportSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/subscriptions/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all }),
  });
}

export function useRunReportSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<AsyncTask>(`/api/report/subscriptions/${id}/run`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all }),
  });
}

export function useBatchReportSubscriptionEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) =>
      request.put<null>('/api/report/subscriptions/batch-status', { ids, enabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all }),
  });
}

export function useReportSubscriptionHistory(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportSubscriptionKeys.history(id),
    enabled: enabled && !!id,
    queryFn: () => request.get<PaginatedResponse<ReportDeliveryRun>>(`/api/report/delivery-runs${toQueryString({ targetType: 'subscription', subscriptionId: id, includeAttempts: true, page: 1, pageSize: 20 })}`).then(unwrap),
  });
}
