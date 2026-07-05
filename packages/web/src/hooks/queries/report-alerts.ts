import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateReportAlertInput, PaginatedResponse, ReportAlertRule, ReportAlertEvalResult } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface ReportAlertListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  datasetId?: string;
  enabled?: boolean;
}

export const reportAlertKeys = {
  all: ['report', 'alerts'] as const,
  lists: ['report', 'alerts', 'list'] as const,
  list: (params: ReportAlertListParams) => ['report', 'alerts', 'list', params] as const,
  detail: (id: number | undefined) => ['report', 'alerts', 'detail', id] as const,
};

export function useReportAlertList(params: ReportAlertListParams) {
  return useQuery({
    queryKey: reportAlertKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<ReportAlertRule>>(`/api/report/alerts${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveReportAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CreateReportAlertInput }) =>
      (id
        ? request.put<ReportAlertRule>(`/api/report/alerts/${id}`, values, { silent: true })
        : request.post<ReportAlertRule>('/api/report/alerts', values, { silent: true })
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportAlertKeys.all }),
  });
}

export function useDeleteReportAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/report/alerts/${id}`, undefined, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportAlertKeys.all }),
  });
}

export function useToggleReportAlertEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request.put<ReportAlertRule>(`/api/report/alerts/${id}`, { enabled }, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportAlertKeys.all }),
  });
}

export function useEvaluateReportAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<ReportAlertEvalResult>(`/api/report/alerts/${id}/evaluate`, undefined, { silent: true }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportAlertKeys.all }),
  });
}
