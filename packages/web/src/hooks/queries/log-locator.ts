import type { QueryOf } from '@zenith/shared/core';
import { logLocatorContract } from '@zenith/shared/ops';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export type LogLocatorParams = NonNullable<QueryOf<typeof logLocatorContract.locate>>;

export const logLocatorKeys = {
  locate: (params: LogLocatorParams) => contractKey(logLocatorContract.locate, { query: params }),
};

export function useLogLocator(correlationId: string | null, context = 2) {
  return useApiQuery(
    logLocatorContract.locate,
    { query: { correlationId: correlationId ?? '', context } },
    { enabled: Boolean(correlationId), staleTime: 0 },
  );
}
