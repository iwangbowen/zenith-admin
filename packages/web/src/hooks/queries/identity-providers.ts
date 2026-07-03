import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IdentityProviderConnectionTestResult,
  IdentityProviderSyncResult,
  LdapDirectoryUser,
  PaginatedResponse,
  Tenant,
  TenantIdentityProvider,
} from '@zenith/shared';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface IdentityProviderListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: string;
  status?: string;
  tenantId?: string;
}

export const identityProviderKeys = {
  all: ['identity-providers'] as const,
  lists: ['identity-providers', 'list'] as const,
  list: (params: IdentityProviderListParams) => ['identity-providers', 'list', params] as const,
  detail: (id: number | undefined) => ['identity-providers', 'detail', id] as const,
  tenants: ['identity-providers', 'tenants'] as const,
};

export function useIdentityProviderList(params: IdentityProviderListParams) {
  return useQuery({
    queryKey: identityProviderKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<TenantIdentityProvider>>(`/api/identity-providers${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useIdentityProviderDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: identityProviderKeys.detail(id),
    queryFn: () => request.get<TenantIdentityProvider>(`/api/identity-providers/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useIdentityProviderTenants() {
  return useQuery({
    queryKey: identityProviderKeys.tenants,
    queryFn: () => request.get<Tenant[]>('/api/tenants/all', { silent: true }).then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveIdentityProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<TenantIdentityProvider>('/api/identity-providers', values)
        : request.put<TenantIdentityProvider>(`/api/identity-providers/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: identityProviderKeys.all }),
  });
}

export function useDeleteIdentityProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/identity-providers/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: identityProviderKeys.all }),
  });
}

export function useTestIdentityProviderConnection() {
  return useMutation({
    mutationFn: (id: number) =>
      request.post<IdentityProviderConnectionTestResult>(`/api/identity-providers/${id}/test`, {}, { silent: true }).then(unwrap),
  });
}

export function useSearchLdapDirectoryUsers() {
  return useMutation({
    mutationFn: ({ id, keyword }: { id: number; keyword?: string }) =>
      request.get<LdapDirectoryUser[]>(`/api/identity-providers/${id}/ldap/users${toQueryString({ limit: 20, keyword })}`, { silent: true }).then(unwrap),
  });
}

export function useSyncIdentityProviderDirectory() {
  return useMutation({
    mutationFn: (id: number) =>
      request.post<IdentityProviderSyncResult>(`/api/identity-providers/${id}/sync`, { limit: 500 }, { silent: true }).then(unwrap),
  });
}
