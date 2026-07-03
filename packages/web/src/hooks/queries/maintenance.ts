import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MaintenanceLog, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  updatedAt: string;
}

export interface MaintenanceLogListParams {
  page: number;
  pageSize: number;
}

export interface UpdateMaintenanceStatusInput {
  enabled: boolean;
  message: string;
  estimatedEndAt: string | null;
}

export const maintenanceKeys = {
  all: ['maintenance'] as const,
  status: ['maintenance', 'status'] as const,
  logs: ['maintenance', 'logs'] as const,
  logList: (params: MaintenanceLogListParams) => ['maintenance', 'logs', params] as const,
};

export function useMaintenanceStatus() {
  return useQuery({
    queryKey: maintenanceKeys.status,
    queryFn: () => request.get<MaintenanceStatus>('/api/maintenance').then(unwrap),
  });
}

export function useMaintenanceLogs(params: MaintenanceLogListParams) {
  return useQuery({
    queryKey: maintenanceKeys.logList(params),
    queryFn: () => request.get<PaginatedResponse<MaintenanceLog>>(`/api/maintenance/logs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateMaintenanceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: UpdateMaintenanceStatusInput) => request.put<MaintenanceStatus>('/api/maintenance', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: maintenanceKeys.all }),
  });
}
