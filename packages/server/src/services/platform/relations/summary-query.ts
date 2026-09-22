import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { EntityRelationSummaryState } from '@zenith/shared/platform';

/** Each probe must include the same visibility predicate; attention spans every visible row. */
export function relationSummaryQuery(visible: SQLWrapper, attention?: SQLWrapper): SQL<EntityRelationSummaryState> {
  return attention
    ? sql<EntityRelationSummaryState>`case when exists (${attention}) then 'attention' when exists (${visible}) then 'has-data' else 'empty' end`
    : sql<EntityRelationSummaryState>`case when exists (${visible}) then 'has-data' else 'empty' end`;
}
