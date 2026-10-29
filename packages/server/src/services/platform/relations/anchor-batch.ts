import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import type { EntityAnchorResolver, RelationAccessContext, VisibleEntityAnchor } from './types';

export function anchorIdsWhere(column: AnyPgColumn, ids: readonly (string | number)[]): SQL {
  return ids.length === 0 ? sql`false` : ids.length === 1 ? eq(column, ids[0]) : inArray(column, [...ids]);
}

/** Scalar and batch reads share the exact same authorization query. */
export function defineAnchorResolver<K extends string | number>(
  type: CanonicalEntityType,
  parse: (key: string) => K | undefined,
  load: (ids: K[], access: RelationAccessContext) => Promise<VisibleEntityAnchor[]>,
): EntityAnchorResolver {
  const resolveMany: EntityAnchorResolver['resolveMany'] = async (keys, access) => {
    const ids = [...new Set(keys.map(parse).filter((id): id is K => id !== undefined))];
    return ids.length ? load(ids, access) : [];
  };
  return { type, resolveMany, resolve: async (ref, access) => ref.type === type ? (await resolveMany([ref.key], access))[0] ?? null : null };
}

export function numericAnchorResolver(
  type: CanonicalEntityType,
  load: (ids: number[], access: RelationAccessContext) => Promise<VisibleEntityAnchor[]>,
): EntityAnchorResolver {
  return defineAnchorResolver(type, (key) => {
    const id = Number(key);
    return /^[1-9]\d*$/.test(key) && Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : undefined;
  }, load);
}
