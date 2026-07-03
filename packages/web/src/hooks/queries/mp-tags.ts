import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpTag, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpTagListParams {
  accountId: number | null;
  page: number;
  pageSize: number;
  keyword?: string;
}

export const mpTagKeys = {
  all: ['mp', 'tags'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'tags', accountId, 'list'] as const,
  list: (params: MpTagListParams) => ['mp', 'tags', params.accountId, 'list', params] as const,
  options: (accountId: number | null | undefined) => ['mp', 'tags', accountId, 'options'] as const,
};

export function useMpTagList(params: MpTagListParams) {
  return useQuery({
    queryKey: mpTagKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<MpTag>>(`/api/mp/tags${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: !!params.accountId,
  });
}

export function useMpTagOptions(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpTagKeys.options(accountId),
    queryFn: () => request.get<PaginatedResponse<MpTag>>(`/api/mp/tags${toQueryString({ page: 1, pageSize: 200, accountId })}`).then(unwrap),
    enabled: !!accountId,
  });
}

export function useSyncMpTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<{ created: number; updated: number; total: number }>('/api/mp/tags/sync', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTagKeys.all }),
  });
}

export function useSaveMpTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountId, name }: { id?: number; accountId: number; name: string }) =>
      (id === undefined
        ? request.post<MpTag>('/api/mp/tags', { accountId, name })
        : request.put<MpTag>(`/api/mp/tags/${id}`, { name })
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTagKeys.all }),
  });
}

export function useDeleteMpTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/tags/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpTagKeys.all }),
  });
}
