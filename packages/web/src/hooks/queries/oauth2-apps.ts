import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiScope, OAuth2Client, OAuth2ClientCreated, PaginatedResponse, RatePlan } from '@zenith/shared';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface OAuth2AppListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const oauth2AppKeys = {
  all: ['oauth2-apps'] as const,
  lists: ['oauth2-apps', 'list'] as const,
  list: (params: OAuth2AppListParams) => ['oauth2-apps', 'list', params] as const,
  detail: (id: number | undefined) => ['oauth2-apps', 'detail', id] as const,
  ratePlans: ['oauth2-apps', 'rate-plans'] as const,
  scopes: ['oauth2-apps', 'scopes'] as const,
};

export function useOAuth2AppList(params: OAuth2AppListParams) {
  return useQuery({
    queryKey: oauth2AppKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<OAuth2Client>>(`/api/oauth2/clients${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useOAuth2AppDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: oauth2AppKeys.detail(id),
    queryFn: () => request.get<OAuth2Client>(`/api/oauth2/clients/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useOAuth2RatePlans() {
  return useQuery({
    queryKey: oauth2AppKeys.ratePlans,
    queryFn: () => request.get<RatePlan[]>('/api/rate-plans/options', { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useOAuth2ApiScopes() {
  return useQuery({
    queryKey: oauth2AppKeys.scopes,
    queryFn: () => request.get<ApiScope[]>('/api/api-scopes/options', { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveOAuth2App() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<OAuth2ClientCreated>('/api/oauth2/clients', values)
        : request.put<OAuth2Client>(`/api/oauth2/clients/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: oauth2AppKeys.all }),
  });
}

export function useDeleteOAuth2App() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/oauth2/clients/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: oauth2AppKeys.all }),
  });
}

export function useRegenerateOAuth2AppSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<{ clientId: string; clientSecret: string }>(`/api/oauth2/clients/${id}/regenerate-secret`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: oauth2AppKeys.all }),
  });
}
