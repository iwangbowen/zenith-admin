// Identity-scoped keys and cursor accumulation require the underlying query hooks.
// eslint-disable-next-line no-restricted-imports
import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { entityRelationsContract, entityTimelineContract, type CanonicalEntityType } from '@zenith/shared/platform';
import { api, apiQueryOptions, contractKey, useApiMutation } from '@/lib/contract-query';
import { useAuth } from '@/hooks/useAuth';

const RELATION_STALE_TIME = 15_000;

export function useEntityAccessKey() {
  const { user, impersonation } = useAuth();
  return [user?.id ?? null, user?.tenantId ?? null, user?.viewingTenantId ?? null, impersonation?.impersonationId ?? null] as const;
}

/** Newly added relations can affect any anchor; mark all summaries stale, refetch only active groups. */
export function invalidateEntityRelations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: contractKey(entityRelationsContract.describe).slice(0, 1) });
}

export function useLinkEntity() {
  return useApiMutation(entityRelationsContract.link, { invalidate: (qc) => { void invalidateEntityRelations(qc); } });
}

export function useUnlinkEntity() {
  return useApiMutation(entityRelationsContract.unlink, { invalidate: (qc) => { void invalidateEntityRelations(qc); } });
}

export function useEntityRelations(type: CanonicalEntityType, key: string | undefined, enabled = true) {
  const access = useEntityAccessKey();
  const options = apiQueryOptions(entityRelationsContract.describe,
    { params: { type, key: key ?? '' } },
    { enabled: enabled && Boolean(key) && access[0] !== null, staleTime: RELATION_STALE_TIME, retry: false, requestOptions: { silent: true } });
  return useQuery({ ...options, queryKey: [...options.queryKey, access] });
}

export function useEntityRelationSection(type: CanonicalEntityType, key: string | undefined, sectionKey: string, enabled = true, limit = 5) {
  const access = useEntityAccessKey();
  const params = { type, key: key ?? '', sectionKey };
  return useInfiniteQuery({
    queryKey: [...contractKey(entityRelationsContract.section, { params, query: { limit } }), access],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api(entityRelationsContract.section, { params, query: { limit, cursor: pageParam } }, { silent: true, signal }),
    getNextPageParam: (lastPage) => lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    enabled: enabled && Boolean(key) && access[0] !== null,
    staleTime: RELATION_STALE_TIME,
    retry: false,
  });
}

export function useEntityTimeline(type: CanonicalEntityType, key: string | undefined, enabled = true, limit = 20) {
  const access = useEntityAccessKey();
  const params = { type, key: key ?? '' };
  return useInfiniteQuery({
    queryKey: [...contractKey(entityTimelineContract.timeline, { params, query: { limit } }), access],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api(entityTimelineContract.timeline, { params, query: { limit, cursor: pageParam } }, { silent: true, signal }),
    getNextPageParam: (lastPage) => lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    enabled: enabled && Boolean(key) && access[0] !== null,
    staleTime: RELATION_STALE_TIME,
    retry: false,
  });
}
