import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { identitySecurityContract } from '@zenith/shared/identity';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type LoginRiskEventListParams = NonNullable<QueryOf<typeof identitySecurityContract.riskEvents>>;

// 身份安全策略本身由运行时设置承载：读写走 hooks/queries/settings 的 useSettings('identitySecurity') / useSaveSettings
export const identitySecurityKeys = {
  all: ['identity-security'] as const,
  riskLists: contractKey(identitySecurityContract.riskEvents),
  riskList: (params: LoginRiskEventListParams) => contractKey(identitySecurityContract.riskEvents, { query: params }),
};

export function useLoginRiskEventList(params: LoginRiskEventListParams, enabled = true) {
  return useApiQuery(identitySecurityContract.riskEvents, { query: params }, {
    enabled,
    placeholderData: keepPreviousData,
  });
}
