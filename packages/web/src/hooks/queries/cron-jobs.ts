import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CronJob, CronJobStats, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface CronJobListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export interface CronJobLog {
  id: number;
  jobId: number;
  jobName: string;
  executionCount: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: 'success' | 'fail' | 'running';
  output: string | null;
}

export interface CronJobLogsParams {
  jobId: number;
  page: number;
  pageSize: number;
}

export interface CronJobAllLogsParams {
  page: number;
  pageSize: number;
  jobId?: number;
}

export const cronJobKeys = {
  all: ['cron-jobs'] as const,
  handlers: ['cron-jobs', 'handlers'] as const,
  stats: ['cron-jobs', 'stats'] as const,
  lists: ['cron-jobs', 'list'] as const,
  list: (params: CronJobListParams) => ['cron-jobs', 'list', params] as const,
  detail: (id: number | undefined) => ['cron-jobs', 'detail', id] as const,
  logs: ['cron-jobs', 'logs'] as const,
  jobLogs: (params: CronJobLogsParams) => ['cron-jobs', 'logs', 'job', params] as const,
  allLogs: (params: CronJobAllLogsParams) => ['cron-jobs', 'logs', 'all', params] as const,
};

export function useCronJobList(params: CronJobListParams) {
  return useQuery({
    queryKey: cronJobKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<CronJob>>(`/api/cron-jobs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useCronJobHandlers() {
  return useQuery({
    queryKey: cronJobKeys.handlers,
    queryFn: () => request.get<string[]>('/api/cron-jobs/handlers').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useCronJobDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cronJobKeys.detail(id),
    queryFn: () => request.get<CronJob>(`/api/cron-jobs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useCronJobStats() {
  return useQuery({
    queryKey: cronJobKeys.stats,
    queryFn: () => request.get<CronJobStats>('/api/cron-jobs/stats').then(unwrap),
  });
}

export function useCronJobLogs(params: CronJobLogsParams, enabled = true) {
  return useQuery({
    queryKey: cronJobKeys.jobLogs(params),
    queryFn: () => request.get<PaginatedResponse<CronJobLog>>(`/api/cron-jobs/${params.jobId}/logs${toQueryString({ page: params.page, pageSize: params.pageSize })}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCronJobAllLogs(params: CronJobAllLogsParams, enabled = true) {
  return useQuery({
    queryKey: cronJobKeys.allLogs(params),
    queryFn: () => request.get<PaginatedResponse<CronJobLog>>(`/api/cron-jobs/logs${toQueryString(params)}`).then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSaveCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<CronJob> }) =>
      (id === undefined ? request.post<CronJob>('/api/cron-jobs', values) : request.put<CronJob>(`/api/cron-jobs/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cronJobKeys.all }),
  });
}

export function useDeleteCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cron-jobs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cronJobKeys.all }),
  });
}

export function useRunCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/cron-jobs/${id}/run`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cronJobKeys.all }),
  });
}

export function useUpdateCronJobStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      request.put<CronJob>(`/api/cron-jobs/${id}/status`, { status }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cronJobKeys.all }),
  });
}

export function useClearCronJobLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ months, jobId }: { months: number; jobId?: number | null }) => {
      const url = jobId !== null && jobId !== undefined
        ? `/api/cron-jobs/${jobId}/logs/clean?months=${months}`
        : `/api/cron-jobs/logs/clean?months=${months}`;
      return request.delete<null>(url).then(unwrap);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cronJobKeys.all }),
  });
}
