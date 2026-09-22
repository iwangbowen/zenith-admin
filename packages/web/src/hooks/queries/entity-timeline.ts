// Identity-scoped keys and cursor accumulation require the underlying query hook.
import { useInfiniteQuery } from '@tanstack/react-query';
import { entityTimelineContract, type CanonicalEntityType } from '@zenith/shared/platform';
import type { QueryOf } from '@zenith/shared/core';
import { api, contractKey } from '@/lib/contract-query';
import { useAuth } from '@/hooks/useAuth';
import { ENTITY_RELATION_QUERY_META, ENTITY_RELATION_REFRESH_OPTIONS } from '@/lib/entity-relation-cache';

export type EntityTimelineFilters = Pick<QueryOf<typeof entityTimelineContract.timeline>, 'eventType' | 'startTime' | 'endTime'>;

export function useEntityTimeline(type: CanonicalEntityType, key: string | undefined, enabled = true, limit = 20, filters: EntityTimelineFilters = {}) {
  const { user, impersonation } = useAuth();
  const access = [user?.id ?? null, user?.tenantId ?? null, user?.viewingTenantId ?? null, impersonation?.impersonationId ?? null];
  const params = { type, key: key ?? '' };
  const query = { limit, ...filters };
  return useInfiniteQuery({
    queryKey: [...contractKey(entityTimelineContract.timeline, { params, query }), access],
    meta: ENTITY_RELATION_QUERY_META,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api(entityTimelineContract.timeline, { params, query: { ...query, cursor: pageParam } }, { silent: true, signal }),
    getNextPageParam: (lastPage) => lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    enabled: enabled && Boolean(key) && access[0] !== null,
    ...ENTITY_RELATION_REFRESH_OPTIONS,
    retry: false,
  });
}
