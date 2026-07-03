import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DataMaskConfig, PaginatedResponse, Role, SensitiveField } from '@zenith/shared';
import { request } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

export interface DataMaskListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  maskType?: string;
  enabled?: string;
}

export const dataMaskKeys = {
  all: ['data-mask'] as const,
  lists: ['data-mask', 'list'] as const,
  list: (params: DataMaskListParams) => ['data-mask', 'list', params] as const,
  detail: (id: number | undefined) => ['data-mask', 'detail', id] as const,
  roleOptions: ['data-mask', 'role-options'] as const,
};

export function useDataMaskList(params: DataMaskListParams) {
  return useQuery({
    queryKey: dataMaskKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<DataMaskConfig>>(`/api/data-mask-configs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useDataMaskDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: dataMaskKeys.detail(id),
    queryFn: () => request.get<DataMaskConfig>(`/api/data-mask-configs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useDataMaskRoleOptions() {
  return useQuery({
    queryKey: dataMaskKeys.roleOptions,
    queryFn: () =>
      request
        .get<Role[]>('/api/roles/all')
        .then(unwrap)
        .then((roles) => roles.map((r) => ({ value: r.code, label: r.name }))),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveDataMask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Partial<DataMaskConfig> }) =>
      (id === undefined
        ? request.post<DataMaskConfig>('/api/data-mask-configs', values)
        : request.put<DataMaskConfig>(`/api/data-mask-configs/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataMaskKeys.all }),
  });
}

export function useDeleteDataMask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/data-mask-configs/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataMaskKeys.all }),
  });
}

export function useScanDataMaskFields() {
  return useMutation({
    mutationFn: () => request.get<SensitiveField[]>('/api/data-mask-configs/scan').then(unwrap),
  });
}

export function useBatchCreateDataMask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Array<Partial<DataMaskConfig>>) =>
      request.post<{ created: number; skipped: number }>('/api/data-mask-configs/batch-create', { items }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataMaskKeys.all }),
  });
}
