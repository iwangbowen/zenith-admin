// Identity-scoped keys and cursor accumulation require the underlying query hooks.
// eslint-disable-next-line no-restricted-imports
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { entityRelationsContract, type CanonicalEntityType, type EntityRelationFilters } from '@zenith/shared/platform';
import { api, apiQueryOptions, contractKey, useApiMutation } from '@/lib/contract-query';
import { useAuth } from '@/hooks/useAuth';
import { ENTITY_RELATION_QUERY_META, ENTITY_RELATION_REFRESH_OPTIONS, invalidateEntityRelations } from '@/lib/entity-relation-cache';
import { workflowAttachmentContract } from '@zenith/shared/workflow';

export { invalidateEntityRelations } from '@/lib/entity-relation-cache';

export function useEntityAccessKey() {
  const { user, impersonation } = useAuth();
  return [user?.id ?? null, user?.tenantId ?? null, user?.viewingTenantId ?? null, impersonation?.impersonationId ?? null] as const;
}

export function useEntityWorkflowAttachment(id: number) {
  const access = useEntityAccessKey();
  const options = apiQueryOptions(workflowAttachmentContract.detail, { params: { id } }, {
    enabled: access[0] !== null, meta: ENTITY_RELATION_QUERY_META, ...ENTITY_RELATION_REFRESH_OPTIONS, retry: false, requestOptions: { silent: true },
  });
  return useQuery({ ...options, queryKey: [...options.queryKey, access] });
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
    { enabled: enabled && Boolean(key) && access[0] !== null, meta: ENTITY_RELATION_QUERY_META, ...ENTITY_RELATION_REFRESH_OPTIONS, retry: false, requestOptions: { silent: true } });
  return useQuery({ ...options, queryKey: [...options.queryKey, access] });
}

export function useEntityRelationSection(type: CanonicalEntityType, key: string | undefined, sectionKey: string, enabled = true, limit = 5, filters: EntityRelationFilters = {}) {
  const access = useEntityAccessKey();
  const params = { type, key: key ?? '', sectionKey };
  return useInfiniteQuery({
    queryKey: [...contractKey(entityRelationsContract.section, { params, query: { limit, ...filters } }), access],
    meta: ENTITY_RELATION_QUERY_META,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api(entityRelationsContract.section, { params, query: { limit, ...filters, cursor: pageParam } }, { silent: true, signal }),
    getNextPageParam: (lastPage) => lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    enabled: enabled && Boolean(key) && access[0] !== null,
    ...ENTITY_RELATION_REFRESH_OPTIONS,
    retry: false,
  });
}

export { useEntityTimeline } from './entity-timeline';
