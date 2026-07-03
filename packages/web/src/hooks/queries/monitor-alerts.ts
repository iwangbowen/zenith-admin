import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MonitorAlertEvent, MonitorAlertRule, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MonitorAlertListParams {
  page: number;
  pageSize: number;
}

export interface MonitorAlertEventListParams {
  page: number;
  pageSize: number;
  metric?: string;
  level?: string;
  status?: string;
}

export const monitorAlertKeys = {
  all: ['monitor-alerts'] as const,
  lists: ['monitor-alerts', 'list'] as const,
  list: (params: MonitorAlertListParams) => ['monitor-alerts', 'list', params] as const,
  eventLists: ['monitor-alerts', 'events', 'list'] as const,
  eventList: (params: MonitorAlertEventListParams) => ['monitor-alerts', 'events', 'list', params] as const,
};

export function useMonitorAlertList(params: MonitorAlertListParams) {
  return useQuery({
    queryKey: monitorAlertKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<MonitorAlertRule>>(`/api/monitor-alerts${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSaveMonitorAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<MonitorAlertRule>('/api/monitor-alerts', values)
        : request.put<MonitorAlertRule>(`/api/monitor-alerts/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: monitorAlertKeys.all }),
  });
}

export function useDeleteMonitorAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/monitor-alerts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: monitorAlertKeys.all }),
  });
}

export function useToggleMonitorAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request.patch<MonitorAlertRule>(`/api/monitor-alerts/${id}/enabled`, { enabled }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: monitorAlertKeys.all }),
  });
}

export function useMonitorAlertEventList(params: MonitorAlertEventListParams) {
  return useQuery({
    queryKey: monitorAlertKeys.eventList(params),
    queryFn: () =>
      request.get<PaginatedResponse<MonitorAlertEvent>>(`/api/monitor-alerts/events${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}
