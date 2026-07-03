import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationLog, OperationLogStats, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface OperationLogListParams {
  page: number;
  pageSize: number;
  username?: string;
  module?: string;
  description?: string;
  method?: string;
  path?: string;
  ip?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
}

export interface OperationLogStatsParams {
  days: number;
}

export const operationLogKeys = {
  all: ['operation-logs'] as const,
  lists: ['operation-logs', 'list'] as const,
  list: (params: OperationLogListParams) => ['operation-logs', 'list', params] as const,
  stats: ['operation-logs', 'stats'] as const,
  statsDetail: (params: OperationLogStatsParams) => ['operation-logs', 'stats', params] as const,
};

export function useOperationLogList(params: OperationLogListParams) {
  return useQuery({
    queryKey: operationLogKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<OperationLog>>(`/api/operation-logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useOperationLogStats(params: OperationLogStatsParams) {
  return useQuery({
    queryKey: operationLogKeys.statsDetail(params),
    queryFn: () => request.get<OperationLogStats>(`/api/operation-logs/stats${toQueryString(params)}`).then(unwrap),
  });
}

export function useCleanOperationLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (months: number) => request.delete<null>(`/api/operation-logs/clean${toQueryString({ months })}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: operationLogKeys.all }),
  });
}
