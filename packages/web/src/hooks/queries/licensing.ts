import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { licensingContract } from '@zenith/shared/licensing';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type LicenseEventListParams = NonNullable<QueryOf<typeof licensingContract.events>>;

export const licensingKeys = {
  all: [resourceKeyOf(licensingContract.basePath)] as const,
  status: contractKey(licensingContract.status),
  events: contractKey(licensingContract.events),
  eventList: (params: LicenseEventListParams) => contractKey(licensingContract.events, { query: params }),
};

export function useLicensingStatus() {
  return useApiQuery(licensingContract.status);
}

export function useLicenseEvents(params: LicenseEventListParams) {
  return useApiQuery(licensingContract.events, { query: params }, { placeholderData: (prev) => prev });
}

/** 激活成功后整域失效：状态、事件都会变化 */
export function useActivateLicense() {
  return useApiMutation(licensingContract.activate, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: licensingKeys.all }),
  });
}

export function useDeactivateLicense() {
  return useApiMutation(licensingContract.deactivate, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: licensingKeys.all }),
  });
}
