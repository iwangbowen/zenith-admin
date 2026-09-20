import { entityRelationsContract, entityTimelineContract, type CanonicalEntityType } from '@zenith/shared/platform';
import { contractKey, useApiQuery } from '@/lib/contract-query';
import type { QueryClient } from '@tanstack/react-query';

const RELATION_STALE_TIME = 15_000;

export function invalidateEntityRelations(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: contractKey(entityRelationsContract.describe) });
  void queryClient.invalidateQueries({ queryKey: contractKey(entityRelationsContract.list) });
  void queryClient.invalidateQueries({ queryKey: contractKey(entityTimelineContract.list) });
}

export function useEntityRelations(type: CanonicalEntityType, key: string | undefined, enabled = true) {
  return useApiQuery(
    entityRelationsContract.describe,
    { params: { type, key: key ?? '' }, query: { limit: 5 } },
    { enabled: enabled && Boolean(key), staleTime: RELATION_STALE_TIME, retry: false },
  );
}

export function useEntityRelationSection(
  type: CanonicalEntityType,
  key: string | undefined,
  sectionKey: string,
  enabled = true,
  limit = 5,
) {
  return useApiQuery(
    entityRelationsContract.list,
    { params: { type, key: key ?? '', sectionKey }, query: { limit } },
    { enabled: enabled && Boolean(key), staleTime: RELATION_STALE_TIME, retry: false },
  );
}

export function useEntityTimeline(type: CanonicalEntityType, key: string | undefined, enabled = true, limit = 20) {
  return useApiQuery(
    entityTimelineContract.list,
    { params: { type, key: key ?? '' }, query: { limit } },
    { enabled: enabled && Boolean(key), staleTime: RELATION_STALE_TIME, retry: false },
  );
}
