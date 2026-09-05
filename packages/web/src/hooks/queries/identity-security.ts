import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { identitySecurityContract } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';

export type LoginRiskEventListParams = NonNullable<QueryOf<typeof identitySecurityContract.riskEvents>>;

// 身份安全策略本身由运行时设置承载：读写走 hooks/queries/settings 的 useSettings('identitySecurity') / useSaveSettings
export const identitySecurityKeys = {
  all: ['identity-security'] as const,
  riskLists: ['identity-security', 'risk-events'] as const,
  riskList: (params: LoginRiskEventListParams) => ['identity-security', 'risk-events', params] as const,
};

export function useLoginRiskEventList(params: LoginRiskEventListParams) {
  return useQuery({
    queryKey: identitySecurityKeys.riskList(params),
    queryFn: () => api(identitySecurityContract.riskEvents, { query: params }),
    placeholderData: keepPreviousData,
  });
}