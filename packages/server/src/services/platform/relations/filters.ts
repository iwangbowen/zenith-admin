import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { normalizeEntityRelationFilters, supportsEntityRelationFilters, type EntityRelationFilterCapabilities, type EntityRelationFilters } from '@zenith/shared/platform';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../../lib/where-helpers';

/** Match the full authorized SQL set, before ordering or LIMIT. */
export function relationFilterWhere(filters: EntityRelationFilters | undefined, columns: {
  keyword?: readonly (PgColumn | SQL)[];
  status?: PgColumn | SQL;
  occurredAt?: PgColumn;
  attention?: SQL;
}): SQL | undefined {
  if (!filters) return undefined;
  return buildWhere(
    keywordCondition(filters.keyword, columns.keyword ?? [], 'ilike'),
    filters.status && columns.status ? sql`${columns.status} = ${filters.status}` : undefined,
    ...(columns.occurredAt ? dateRangeConditions(columns.occurredAt, filters.startTime, filters.endTime) : []),
    filters.attentionOnly ? columns.attention : undefined,
  );
}

/** A stable signature binds every cursor to the exact normalized filter set. */
export function normalizeRelationFilters(filters: EntityRelationFilters): EntityRelationFilters {
  return normalizeEntityRelationFilters(filters);
}

export function assertSupportedRelationFilters(filters: EntityRelationFilters, capabilities?: EntityRelationFilterCapabilities) {
  if (!supportsEntityRelationFilters(filters, capabilities)) {
    throw new HTTPException(400, { message: '该关联分组不支持所选筛选条件' });
  }
}

/** Only for polymorphic targets that have already passed their own resolver. */
export function matchesRelationKeyword(keyword: string | undefined, ...values: Array<string | null | undefined>): boolean {
  const term = keyword?.trim().toLocaleLowerCase();
  return !term || values.some((value) => value?.toLocaleLowerCase().includes(term));
}
