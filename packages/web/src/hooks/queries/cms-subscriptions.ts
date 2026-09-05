import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsSubscriptionContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey } from '@/lib/contract-query';

export type CmsSubscriptionListParams = NonNullable<QueryOf<typeof cmsSubscriptionContract.list>>;

export type CmsSubscriptionAggregateParams = NonNullable<QueryOf<typeof cmsSubscriptionContract.aggregates>>;

export const cmsSubscriptionKeys = {
  lists: contractKey(cmsSubscriptionContract.list),
  list: (params: CmsSubscriptionListParams) => contractKey(cmsSubscriptionContract.list, { query: params }),
  aggregates: (params: CmsSubscriptionAggregateParams) => contractKey(cmsSubscriptionContract.aggregates, { query: params }),
};

export function useCmsSubscriptionList(params: CmsSubscriptionListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSubscriptionContract.list, { query: params }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCmsSubscriptionAggregates(params: CmsSubscriptionAggregateParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSubscriptionContract.aggregates, { query: params }),
    enabled,
  });
}
