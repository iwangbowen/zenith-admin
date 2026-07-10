import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaginatedResponse,
  ReportDataset,
  ReportDataResult,
  ReportDatasetExecutionLog,
  ReportDatasetPreviewInput,
  ReportDatasetRefs,
  ReportExecutionStats,
  ReportMetaColumn,
  ReportRuntimeGovernance,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { useReportLookup } from './report-lookups';

export interface ReportDatasetListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
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
  refs: (id: number | undefined) => ['report', 'datasets', 'refs', id] as const,
  lookup: (params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number }) => ['report', 'datasets', 'lookup', params] as const,
  executionLogs: (params: Record<string, unknown>) => ['report', 'datasets', 'execution-logs', params] as const,
  executionStats: (params: Record<string, unknown>) => ['report', 'datasets', 'execution-stats', params] as const,
  governance: ['report', 'datasets', 'governance'] as const,
  metaTables: ['report', 'datasets', 'meta-tables'] as const,
  metaColumns: (table: string) => ['report', 'datasets', 'meta-columns', table] as const,
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

/** 数据集下游引用（血缘弹窗） */
export function useReportDatasetRefs(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.refs(id),
    queryFn: () => request.get<ReportDatasetRefs>(`/api/report/datasets/${id}/refs`).then(unwrap),
    enabled: enabled && !!id,
  });
}

/** 可视化建模：内置库可用表清单 */
export function useReportMetaTables(enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.metaTables,
    queryFn: () => request.get<string[]>('/api/report/meta/tables').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

/** 可视化建模：某表列清单 */
export function useReportMetaColumns(table: string | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.metaColumns(table ?? ''),
    queryFn: () => request.get<ReportMetaColumn[]>(`/api/report/meta/tables/${encodeURIComponent(table!)}/columns`).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
    enabled: enabled && !!table,
  });
}

export function useReportDatasetLookup(params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number } = {}, enabled = true) {
  return useReportLookup('datasets', params, enabled);
}

export function useEnabledReportDatasets(keyword?: string, enabled = true) {
  return useReportDatasetLookup({ keyword, status: 'enabled', limit: 50 }, enabled);
}

export function useEnabledReportDatasources(keyword?: string, enabled = true) {
  return useReportLookup('datasources', { keyword, status: 'enabled', limit: 50 }, enabled);
}

export function useReportDatasetExecutionLogs(params: {
  datasetId?: number;
  datasourceId?: number;
  dashboardId?: number;
  scene?: string;
  success?: boolean;
  slow?: boolean;
  startAt?: string;
  endAt?: string;
  page?: number;
  pageSize?: number;
}, enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.executionLogs(params),
    queryFn: () => request.get<PaginatedResponse<ReportDatasetExecutionLog>>(`/api/report/executions${toQueryString(params)}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useReportDatasetExecutionStats(params: {
  datasetId?: number;
  datasourceId?: number;
  dashboardId?: number;
  scene?: string;
  success?: boolean;
  startAt?: string;
  endAt?: string;
}, enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.executionStats(params),
    queryFn: () => request.get<ReportExecutionStats>(`/api/report/executions/stats${toQueryString(params)}`).then(unwrap),
    enabled,
  });
}

export function useReportRuntimeGovernance(enabled = true) {
  return useQuery({
    queryKey: reportDatasetKeys.governance,
    queryFn: () => request.get<ReportRuntimeGovernance>('/api/report/executions/governance').then(unwrap),
    enabled,
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/report/datasets/${id}/materialize`).then(unwrap),
    // 物化刷新改变数据集行数/更新时间，需失效列表与详情缓存
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasetKeys.all }),
  });
}

export function useBatchReportDatasetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: 'enabled' | 'disabled' }) =>
      request.put<null>('/api/report/datasets/batch-status', { ids, status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasetKeys.all }),
  });
}

export function useCloneReportDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name?: string }) =>
      request.post<ReportDataset>(`/api/report/datasets/${id}/clone`, name ? { name } : {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasetKeys.all }),
  });
}
