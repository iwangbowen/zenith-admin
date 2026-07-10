import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AsyncTask, PaginatedResponse, ReportDatasource } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { useReportLookup } from './report-lookups';

export interface ReportDatasourceListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: string;
  status?: string;
}

export interface TestReportDatasourceConnectionInput {
  id?: number;
  type: string;
  config: Record<string, unknown>;
}

export const reportDatasourceKeys = {
  all: ['report', 'datasources'] as const,
  lists: ['report', 'datasources', 'list'] as const,
  list: (params: ReportDatasourceListParams) => ['report', 'datasources', 'list', params] as const,
  detail: (id: number | undefined) => ['report', 'datasources', 'detail', id] as const,
  lookup: (params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number }) => ['report', 'datasources', 'lookup', params] as const,
};

export function useReportDatasourceList(params: ReportDatasourceListParams) {
  return useQuery({
    queryKey: reportDatasourceKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportDatasource>>(`/api/report/datasources${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useReportDatasourceDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDatasourceKeys.detail(id),
    queryFn: () => request.get<ReportDatasource>(`/api/report/datasources/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useReportDatasourceLookup(params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number } = {}, enabled = true) {
  return useReportLookup('datasources', params, enabled);
}

export function useSaveReportDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id ? request.put<ReportDatasource>(`/api/report/datasources/${id}`, values) : request.post<ReportDatasource>('/api/report/datasources', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}

export function useDeleteReportDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/datasources/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}

export function useTestReportDatasourceConnection() {
  return useMutation({
    mutationFn: (values: TestReportDatasourceConnectionInput) =>
      request.post<{ ok: boolean; message: string; latencyMs?: number }>('/api/report/datasources/test', values, { silent: true }).then(unwrap),
  });
}

export function useRunReportDatasourceHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => request.post<AsyncTask>('/api/report/datasources/health-check', { ids }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}

export function useBatchReportDatasourceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: 'enabled' | 'disabled' }) =>
      request.put<null>('/api/report/datasources/batch-status', { ids, status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}

export function useCloneReportDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name?: string }) =>
      request.post<ReportDatasource>(`/api/report/datasources/${id}/clone`, name ? { name } : {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportDatasourceKeys.all }),
  });
}
