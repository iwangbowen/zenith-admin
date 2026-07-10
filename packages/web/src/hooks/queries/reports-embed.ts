import { useQuery } from '@tanstack/react-query';
import type { ReportPublicDashboard, ReportDatasetQueryOptions, ReportWidgetDataResult } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { useReportDashboardBatch } from './report-dashboards';

export const reportEmbedKeys = {
  all: ['reports', 'embed'] as const,
  token: (token: string | undefined) => ['reports', 'embed', 'token', token] as const,
  data: (
    token: string | undefined,
    filters: Record<string, unknown>,
    widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  ) => ['reports', 'embed', 'data', token, filters, widgetQueries ?? null] as const,
};

export function useReportEmbedDashboard(dashboardId: number | undefined, embedToken?: string) {
  const batchQuery = useReportDashboardBatch(dashboardId ? [dashboardId] : [], !embedToken && !!dashboardId, 'published');
  const tokenQuery = useQuery({
    queryKey: reportEmbedKeys.token(embedToken),
    queryFn: () => request.get<ReportPublicDashboard>(`/api/report/public/embed/${embedToken}`, { skipAuth: true, silent: true }).then(unwrap),
    enabled: !!embedToken,
  });

  if (embedToken) {
    return {
      dataUpdatedAt: tokenQuery.dataUpdatedAt,
      error: tokenQuery.error,
      failureCount: tokenQuery.failureCount,
      isError: tokenQuery.isError,
      isFetching: tokenQuery.isFetching,
      isLoading: tokenQuery.isLoading,
      isPending: tokenQuery.isPending,
      refetch: tokenQuery.refetch,
      data: tokenQuery.data ? ({
        id: 0,
        name: tokenQuery.data.name,
        layout: tokenQuery.data.layout,
        canvasLayout: tokenQuery.data.canvasLayout,
        widgets: tokenQuery.data.widgets,
        filters: tokenQuery.data.filters,
        filterOptions: tokenQuery.data.filterOptions,
        config: tokenQuery.data.config,
        status: 'enabled',
        lifecycleStatus: 'published',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      }) : null,
    };
  }

  return {
    dataUpdatedAt: batchQuery.dataUpdatedAt,
    error: batchQuery.error,
    failureCount: batchQuery.failureCount,
    isError: batchQuery.isError,
    isFetching: batchQuery.isFetching,
    isLoading: batchQuery.isLoading,
    isPending: batchQuery.isPending,
    refetch: batchQuery.refetch,
    data: batchQuery.data?.[0] ? { ...batchQuery.data[0], filterOptions: undefined } : null,
  };
}

export function useReportEmbedData(
  embedToken: string | undefined,
  filters: Record<string, unknown>,
  widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  enabled = true,
) {
  return useQuery({
    queryKey: reportEmbedKeys.data(embedToken, filters, widgetQueries),
    queryFn: () => request.post<Record<string, ReportWidgetDataResult>>(
      `/api/report/public/embed/${embedToken}/data`,
      { filters, widgetQueries },
      { skipAuth: true, silent: true },
    ).then(unwrap),
    enabled: enabled && !!embedToken,
  });
}
