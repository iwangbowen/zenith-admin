import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginLog, LoginLogStats, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface LoginLogListParams {
  page: number;
  pageSize: number;
  username?: string;
  eventType?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export interface LoginLogStatsParams {
  days: number;
}

export const loginLogKeys = {
  all: ['login-logs'] as const,
  lists: ['login-logs', 'list'] as const,
  list: (params: LoginLogListParams) => ['login-logs', 'list', params] as const,
  stats: ['login-logs', 'stats'] as const,
  statsDetail: (params: LoginLogStatsParams) => ['login-logs', 'stats', params] as const,
};

export function useLoginLogList(params: LoginLogListParams) {
  return useQuery({
    queryKey: loginLogKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<LoginLog>>(`/api/login-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useLoginLogStats(params: LoginLogStatsParams) {
  return useQuery({
    queryKey: loginLogKeys.statsDetail(params),
    queryFn: () => request.get<LoginLogStats>(`/api/login-logs/stats${toQueryString(params)}`).then(unwrap),
  });
}

export function useCleanLoginLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (months: number) => request.delete<null>(`/api/login-logs/clean${toQueryString({ months })}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: loginLogKeys.all }),
  });
}
