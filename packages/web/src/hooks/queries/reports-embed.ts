import { useQuery } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { reportPublicContract, type ReportDatasetQueryOptions } from '@zenith/shared/report';
import { api, contractKey } from '@/lib/contract-query';
import { useReportDashboardBatch } from './report-dashboards';

type EmbedDataBody = BodyOf<typeof reportPublicContract.embedData>;

const embedRequest = { skipAuth: true, silent: true } as const;

export const reportEmbedKeys = {
  token: (token: string | undefined) => contractKey(reportPublicContract.embed, { params: { token: token ?? '' } }),
  data: (token: string | undefined, body: EmbedDataBody) =>
    contractKey(reportPublicContract.embedData, { params: { token: token ?? '' }, body }),
};

export function useReportEmbedDashboard(dashboardId: number | undefined, embedToken?: string) {
  const batchQuery = useReportDashboardBatch(dashboardId ? [dashboardId] : [], !embedToken && !!dashboardId, 'published');
  const tokenQuery = useQuery({
    queryKey: reportEmbedKeys.token(embedToken),
    queryFn: () => api(reportPublicContract.embed, { params: { token: embedToken ?? '' } }, embedRequest),
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
  const body: EmbedDataBody = { filters, widgetQueries };
  return useQuery({
    queryKey: reportEmbedKeys.data(embedToken, body),
    queryFn: () => api(reportPublicContract.embedData, { params: { token: embedToken ?? '' }, body }, embedRequest),
    enabled: enabled && !!embedToken,
  });
}
