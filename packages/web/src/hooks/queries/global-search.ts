import { useDebouncedValue } from '@tanstack/react-pacer';
// This hook appends the authenticated identity to the contract query key to isolate search caches.
// eslint-disable-next-line no-restricted-imports
import { useQuery } from '@tanstack/react-query';
import { globalSearchContract, type GlobalSearchType } from '@zenith/shared/platform';
import { apiQueryOptions } from '@/lib/contract-query';
import { useAuth } from '@/hooks/useAuth';

const GLOBAL_SEARCH_STALE_TIME = 15_000;

export function useGlobalSearch(query: string, enabled: boolean, types?: readonly GlobalSearchType[], limit = 5) {
  const { user, impersonation } = useAuth();
  const [debouncedQuery] = useDebouncedValue(query.trim(), { wait: 250 });
  const canSearch = enabled && debouncedQuery.length >= 2;
  const typeFilter = types?.length ? types.join(',') : undefined;
  const queryOptions = apiQueryOptions(
    globalSearchContract.search,
    { query: { q: debouncedQuery || '  ', limit, ...(typeFilter ? { types: typeFilter } : {}) } },
    {
      enabled: canSearch,
      staleTime: GLOBAL_SEARCH_STALE_TIME,
      retry: false,
      requestOptions: { silent: true },
    },
  );
  const identityKey = [
    user?.id ?? 'anonymous',
    user?.tenantId ?? 'platform',
    user?.viewingTenantId ?? 'current',
    impersonation?.impersonationId ?? 'direct',
  ].join(':');
  return useQuery({
    ...queryOptions,
    queryKey: [...queryOptions.queryKey, identityKey],
  });
}
