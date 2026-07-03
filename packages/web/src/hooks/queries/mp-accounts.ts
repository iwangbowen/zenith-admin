import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpAccount, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpAccountListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: string;
  status?: string;
}

export const mpAccountKeys = {
  all: ['mp', 'accounts'] as const,
  lists: ['mp', 'accounts', 'list'] as const,
  list: (params: MpAccountListParams) => ['mp', 'accounts', 'list', params] as const,
  detail: (id: number | undefined) => ['mp', 'accounts', 'detail', id] as const,
};

export function useMpAccountOptions() {
  return useQuery({
    queryKey: mpAccountKeys.all,
    queryFn: () => request.get<PaginatedResponse<MpAccount>>('/api/mp/accounts?page=1&pageSize=100').then(unwrap),
  });
}

export function useMpAccountList(params: MpAccountListParams) {
  return useQuery({
    queryKey: mpAccountKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<MpAccount>>(`/api/mp/accounts${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useMpAccountDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: mpAccountKeys.detail(id),
    queryFn: () => request.get<MpAccount>(`/api/mp/accounts/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveMpAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<MpAccount>('/api/mp/accounts', values)
        : request.put<MpAccount>(`/api/mp/accounts/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpAccountKeys.all }),
  });
}

export function useSetDefaultMpAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/mp/accounts/${id}/default`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpAccountKeys.all }),
  });
}

export function useTestMpAccount() {
  return useMutation({
    mutationFn: (id: number) => request.post<{ success: boolean; message: string }>(`/api/mp/accounts/${id}/test`).then(unwrap),
  });
}

export function useDeleteMpAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/accounts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpAccountKeys.all }),
  });
}
