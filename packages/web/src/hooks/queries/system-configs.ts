import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse, SystemConfig } from '@zenith/shared';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';
import type { PasswordPolicy } from '@/utils/password-policy';

export interface SystemConfigListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  configType?: string;
}

export const systemConfigKeys = {
  all: ['system-configs'] as const,
  lists: ['system-configs', 'list'] as const,
  list: (params: SystemConfigListParams) => ['system-configs', 'list', params] as const,
  detail: (id: number | undefined) => ['system-configs', 'detail', id] as const,
  passwordPolicy: ['system-configs', 'password-policy'] as const,
};

export function useSystemConfigList(params: SystemConfigListParams) {
  return useQuery({
    queryKey: systemConfigKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<SystemConfig>>(`/api/system-configs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useSystemConfigDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: systemConfigKeys.detail(id),
    queryFn: () => request.get<SystemConfig>(`/api/system-configs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveSystemConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<SystemConfig> }) =>
      (id === undefined
        ? request.post<SystemConfig>('/api/system-configs', values)
        : request.put<SystemConfig>(`/api/system-configs/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemConfigKeys.all }),
  });
}

export function useDeleteSystemConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/system-configs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: systemConfigKeys.all }),
  });
}

export function useSystemPasswordPolicy() {
  return useQuery({
    queryKey: systemConfigKeys.passwordPolicy,
    queryFn: () => request.get<PasswordPolicy>('/api/system-configs/password-policy').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}
