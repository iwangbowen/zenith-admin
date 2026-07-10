import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateReportPrintTemplateInput,
  PaginatedResponse,
  ReportPrintRenderResult,
  ReportPrintTemplate,
  UpdateReportPrintTemplateInput,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { useReportLookup } from './report-lookups';

export interface ReportPrintTemplateListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export const reportPrintKeys = {
  all: ['report', 'print'] as const,
  lists: ['report', 'print', 'list'] as const,
  list: (params: ReportPrintTemplateListParams) => ['report', 'print', 'list', params] as const,
  detail: (id: number | undefined) => ['report', 'print', 'detail', id] as const,
  lookup: (params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number }) => ['report', 'print', 'lookup', params] as const,
};

export function useReportPrintTemplateList(params: ReportPrintTemplateListParams) {
  return useQuery({
    queryKey: reportPrintKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportPrintTemplate>>(`/api/report/print${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useReportPrintTemplateDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: reportPrintKeys.detail(id),
    queryFn: () => request.get<ReportPrintTemplate>(`/api/report/print/${id}`).then(unwrap),
    enabled: enabled && !!id,
  });
}

export function useReportPrintTemplateLookup(params: { keyword?: string; status?: 'enabled' | 'disabled'; limit?: number } = {}, enabled = true) {
  return useReportLookup('print', params, enabled);
}

export function useSaveReportPrintTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CreateReportPrintTemplateInput | UpdateReportPrintTemplateInput }) =>
      (id ? request.put<ReportPrintTemplate>(`/api/report/print/${id}`, values) : request.post<ReportPrintTemplate>('/api/report/print', values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportPrintKeys.all }),
  });
}

export function useDeleteReportPrintTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/print/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportPrintKeys.all }),
  });
}

export function useRenderReportPrintTemplate() {
  return useMutation({
    mutationFn: ({ id, params, limit }: { id: number; params: Record<string, unknown>; limit: number }) =>
      request.post<ReportPrintRenderResult>(`/api/report/print/${id}/render`, { params, limit }, { silent: true }).then(unwrap),
  });
}

export function useBatchReportPrintTemplateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: 'enabled' | 'disabled' }) =>
      request.put<null>('/api/report/print/batch-status', { ids, status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportPrintKeys.all }),
  });
}

export function useCloneReportPrintTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name?: string }) =>
      request.post<ReportPrintTemplate>(`/api/report/print/${id}/clone`, name ? { name } : {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportPrintKeys.all }),
  });
}
