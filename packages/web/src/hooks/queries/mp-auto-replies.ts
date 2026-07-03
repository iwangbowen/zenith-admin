import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpAutoReply, MpAutoReplyType, MpMaterial, MpUnmatchedKeyword, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpAutoReplyListParams {
  accountId: number | null;
  page: number;
  pageSize: number;
  replyType?: MpAutoReplyType;
  keyword?: string;
}

export const mpAutoReplyKeys = {
  all: ['mp', 'auto-replies'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'auto-replies', accountId, 'list'] as const,
  list: (params: MpAutoReplyListParams) => ['mp', 'auto-replies', params.accountId, 'list', params] as const,
  materials: (accountId: number | null | undefined) => ['mp', 'auto-replies', accountId, 'materials'] as const,
  unmatched: (accountId: number | null | undefined) => ['mp', 'auto-replies', accountId, 'unmatched'] as const,
};

export function useMpAutoReplyList(params: MpAutoReplyListParams) {
  return useQuery({
    queryKey: mpAutoReplyKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<MpAutoReply>>(`/api/mp/auto-replies${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
    enabled: !!params.accountId,
  });
}

export function useMpAutoReplyMaterials(accountId: number | null | undefined) {
  return useQuery({
    queryKey: mpAutoReplyKeys.materials(accountId),
    queryFn: () => request.get<PaginatedResponse<MpMaterial>>(`/api/mp/materials${toQueryString({ accountId, page: 1, pageSize: 200 })}`).then(unwrap),
    enabled: !!accountId,
  });
}

export function useSaveMpAutoReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<MpAutoReply>('/api/mp/auto-replies', values)
        : request.put<MpAutoReply>(`/api/mp/auto-replies/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpAutoReplyKeys.all }),
  });
}

export function useDeleteMpAutoReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/auto-replies/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpAutoReplyKeys.all }),
  });
}

export function useMpUnmatchedKeywords(accountId: number | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: mpAutoReplyKeys.unmatched(accountId),
    queryFn: () => request.get<PaginatedResponse<MpUnmatchedKeyword>>(`/api/mp/auto-replies/unmatched${toQueryString({ accountId, page: 1, pageSize: 50 })}`).then(unwrap),
    enabled: enabled && !!accountId,
  });
}

export function useDeleteMpUnmatchedKeyword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/auto-replies/unmatched/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpAutoReplyKeys.all }),
  });
}
