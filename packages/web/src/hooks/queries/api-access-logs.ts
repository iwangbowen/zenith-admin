import { keepPreviousData } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type ApiAccessLogListParams = NonNullable<QueryOf<typeof apiAccessLogContract.list>>;

export const apiAccessLogKeys = {
  all: [resourceKeyOf(apiAccessLogContract.basePath)] as const,
  lists: contractKey(apiAccessLogContract.list),
  detail: (id: number | undefined) => contractKey(apiAccessLogContract.detail, { params: { id: id ?? 0 } }),
};

export function useApiAccessLogList(params: ApiAccessLogListParams) {
  return useApiQuery(apiAccessLogContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useApiAccessLogDetail(id: number | undefined, enabled = true) {
  return useApiQuery(apiAccessLogContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

