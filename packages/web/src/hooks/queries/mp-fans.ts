import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpFan, MpFanSubscribe, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpFanListParams {
  accountId: number | null;
  page: number;
  pageSize: number;
  keyword?: string;
  subscribe?: MpFanSubscribe;
  tagId?: number;
  blacklisted?: 'true' | 'false';
}

export const mpFanKeys = {
  all: ['mp', 'fans'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'fans', accountId, 'list'] as const,
  list: (params: MpFanListParams) => ['mp', 'fans', params.accountId, 'list', params] as const,
};

export function useMpFanList(params: MpFanListParams) {
  return useQuery({
    queryKey: mpFanKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<MpFan>>(`/api/mp/fans${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: !!params.accountId,
  });
}

export function useSyncMpFans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<{ synced: number; total: number }>('/api/mp/fans/sync', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpFanKeys.all }),
  });
}

export function useSyncMpBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => request.post<{ synced: number }>('/api/mp/fans/sync-blacklist', { accountId }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpFanKeys.all }),
  });
}

export function useSetMpFanBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, openid, blacklisted }: { accountId: number; openid: string; blacklisted: boolean }) =>
      request.post<null>(`/api/mp/fans/${blacklisted ? 'unblacklist' : 'blacklist'}`, { accountId, openids: [openid] }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpFanKeys.all }),
  });
}

export function useSaveMpFan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: { remark: string; tagIds: number[] } }) =>
      request.put<MpFan>(`/api/mp/fans/${id}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpFanKeys.all }),
  });
}

export function useCreateMpFanMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/mp/fans/${id}/create-member`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpFanKeys.all }),
  });
}

export function useUnbindMpFanMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/mp/fans/${id}/unbind-member`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpFanKeys.all }),
  });
}
