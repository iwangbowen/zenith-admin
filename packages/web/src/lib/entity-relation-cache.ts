import type { QueryClient } from '@tanstack/react-query';

/** Feature metadata lets domain mutations invalidate summaries without importing relation UI or schemas. */
export const ENTITY_RELATION_QUERY_META = { entityRelations: true } as const;

/** A new relation can affect an unseen reverse view; mark every summary stale and refetch active groups. */
export function invalidateEntityRelations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (query) => query.meta?.entityRelations === true });
}
