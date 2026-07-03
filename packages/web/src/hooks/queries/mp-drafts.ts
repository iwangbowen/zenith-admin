import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MpArticle, MpDraft, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface MpDraftListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const mpDraftKeys = {
  all: ['mp', 'drafts'] as const,
  lists: (accountId: number | null | undefined) => ['mp', 'drafts', accountId] as const,
  list: (accountId: number | null | undefined, params: MpDraftListParams) => ['mp', 'drafts', accountId, params] as const,
  detail: (id: number | null | undefined) => ['mp', 'drafts', 'detail', id] as const,
};

export function useMpDraftList(accountId: number | null | undefined, params: MpDraftListParams) {
  return useQuery({
    queryKey: mpDraftKeys.list(accountId, params),
    queryFn: () =>
      request.get<PaginatedResponse<MpDraft>>(`/api/mp/drafts${toQueryString({ ...params, accountId })}`).then(unwrap),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useMpDraftDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: mpDraftKeys.detail(id),
    queryFn: () => request.get<MpDraft>(`/api/mp/drafts/${id}`).then(unwrap),
    enabled: enabled && id != null,
  });
}

export function useSaveMpDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountId, articles }: { id?: number | null; accountId?: number | null; articles: MpArticle[] }) =>
      (id ? request.put<MpDraft>(`/api/mp/drafts/${id}`, { articles }) : request.post<MpDraft>('/api/mp/drafts', { accountId, articles })).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpDraftKeys.all }),
  });
}

export function usePushMpDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<null>(`/api/mp/drafts/${id}/push`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpDraftKeys.all }),
  });
}

export function useDeleteMpDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/mp/drafts/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpDraftKeys.all }),
  });
}
