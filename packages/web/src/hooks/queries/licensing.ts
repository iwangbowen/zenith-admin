import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { licensingContract } from '@zenith/shared/licensing';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type LicenseEventListParams = NonNullable<QueryOf<typeof licensingContract.events>>;

export const licensingKeys = {
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

/** 激活 / 停用改写授权状态并落一条事件：状态与事件列表是本域全部两个查询 */
function invalidateLicensing(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: licensingKeys.status });
  void qc.invalidateQueries({ queryKey: licensingKeys.events });
}

export function useActivateLicense() {
  return useApiMutation(licensingContract.activate, { invalidate: invalidateLicensing });
}

export function useDeactivateLicense() {
  return useApiMutation(licensingContract.deactivate, { invalidate: invalidateLicensing });
}
