import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IdentitySecurityPolicy, LoginRiskEvent, PaginatedResponse } from '@zenith/shared';
import { toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export interface LoginRiskEventListParams {
  page: number;
  pageSize: number;
  keyword?: string;
}

export const identitySecurityKeys = {
  all: ['identity-security'] as const,
  policy: ['identity-security', 'policy'] as const,
  riskLists: ['identity-security', 'risk-events'] as const,
  riskList: (params: LoginRiskEventListParams) => ['identity-security', 'risk-events', params] as const,
};

export function useIdentitySecurityPolicy() {
  return useQuery({
    queryKey: identitySecurityKeys.policy,
    queryFn: () => request.get<IdentitySecurityPolicy>('/api/identity-security/policy').then(unwrap),
  });
}

export function useSaveIdentitySecurityPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: IdentitySecurityPolicy) => request.put<IdentitySecurityPolicy>('/api/identity-security/policy', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: identitySecurityKeys.all }),
  });
}

export function useLoginRiskEventList(params: LoginRiskEventListParams) {
  return useQuery({
    queryKey: identitySecurityKeys.riskList(params),
    queryFn: () => request.get<PaginatedResponse<LoginRiskEvent>>(`/api/identity-security/risk-events${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}
