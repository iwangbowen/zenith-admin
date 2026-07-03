import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, ReportDashboard, ReportDashboardSubscription } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

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
};

export function useReportSubscriptionList(params: ReportSubscriptionListParams) {
  return useQuery({
    queryKey: reportSubscriptionKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportDashboardSubscription>>(`/api/report/subscriptions${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useReportSubscriptionDashboardOptions() {
  return useQuery({
    queryKey: reportSubscriptionKeys.dashboardOptions,
    queryFn: async () => {
      const data = await request.get<PaginatedResponse<ReportDashboard>>('/api/report/dashboards?page=1&pageSize=200').then(unwrap);
      return data.list;
    },
  });
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
    mutationFn: (id: number) => request.post<null>(`/api/report/subscriptions/${id}/run`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportSubscriptionKeys.all }),
  });
}
