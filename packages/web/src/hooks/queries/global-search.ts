import { useDebouncedValue } from '@tanstack/react-pacer';
import { globalSearchContract } from '@zenith/shared/platform';
import { useApiQuery } from '@/lib/contract-query';

const GLOBAL_SEARCH_STALE_TIME = 15_000;

export function useGlobalSearch(query: string, enabled: boolean) {
  const [debouncedQuery] = useDebouncedValue(query.trim(), { wait: 250 });
  const canSearch = enabled && debouncedQuery.length >= 2;
  return useApiQuery(
    globalSearchContract.search,
    { query: { q: debouncedQuery || '  ', limit: 5 } },
    {
      enabled: canSearch,
      staleTime: GLOBAL_SEARCH_STALE_TIME,
      retry: false,
      placeholderData: (previous) => previous,
    },
  );
}

