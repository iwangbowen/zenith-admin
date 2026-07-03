import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, ReportDataset, ReportDataResult, ReportDatasource } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface ReportDatasetListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export interface ReportDatasetPreviewInput {
  datasourceId: number;
  content: Record<string, unknown>;
  computedFields: unknown[];
  limit: number;
}

export interface ParseReportDatasetFileResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
}

export const reportDatasetKeys = {
  all: ['report', 'datasets'] as const,
  lists: ['report', 'datasets', 'list'] as const,
  list: (params: ReportDatasetListParams) => ['report', 'datasets', 'list', params] as const,
  detail: (id: number | undefined) => ['report', 'datasets', 'detail', id] as const,
  enabledDatasets: ['report', 'datasets', 'enabled'] as const,
  enabledDatasources: ['report', 'datasets', 'enabled-datasources'] as const,
};

export function useReportDatasetList(params: ReportDatasetListParams) {
  return useQuery({
    queryKey: reportDatasetKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportDataset>>(`/api/report/datasets${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useReportDatasetDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.detail(id),
    queryFn: () => request.get<ReportDataset>(`/api/report/datasets/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useEnabledReportDatasets() {
  return useQuery({
    queryKey: reportDatasetKeys.enabledDatasets,
    queryFn: async () => {
      const data = await request.get<PaginatedResponse<ReportDataset>>('/api/report/datasets?page=1&pageSize=200').then(unwrap);
      return data.list.filter((dataset) => dataset.status === 'enabled');
    },
  });
}

export function useEnabledReportDatasources() {
  return useQuery({
    queryKey: reportDatasetKeys.enabledDatasources,
    queryFn: async () => {
      const data = await request.get<PaginatedResponse<ReportDatasource>>('/api/report/datasources?page=1&pageSize=200').then(unwrap);
      return data.list.filter((datasource) => datasource.status === 'enabled');
    },
  });
}

export function useSaveReportDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<ReportDataset>(`/api/report/datasets/${id}`, values) : request.post<ReportDataset>('/api/report/datasets', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasetKeys.all }),
  });
}

export function useDeleteReportDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/datasets/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasetKeys.all }),
  });
}

export function usePreviewReportDataset() {
  return useMutation({
    mutationFn: (values: ReportDatasetPreviewInput) =>
      request.post<ReportDataResult>('/api/report/datasets/preview', values, { silent: true }).then(unwrap),
  });
}

export function useParseReportDatasetFile() {
  return useMutation({
    mutationFn: (formData: FormData) =>
      request.postForm<ParseReportDatasetFileResult>('/api/report/datasets/parse-file', formData, { silent: true }).then(unwrap),
  });
}

export function useGenerateReportDatasetSql() {
  return useMutation({
    mutationFn: (values: { question: string; datasetId?: number }) =>
      request.post<{ sql: string }>('/api/report/ai/nl2sql', values, { silent: true }).then(unwrap),
  });
}

export function useRefreshReportDatasetMaterialize() {
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/report/datasets/${id}/materialize`).then(unwrap),
  });
}
