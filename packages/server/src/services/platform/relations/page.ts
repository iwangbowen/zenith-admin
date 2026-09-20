import type { EntityRelationItem, EntityRelationPage } from '@zenith/shared/platform';
import { encodeRelationCursor } from './cursor';
/** Input must be SQL LIMIT limit + 1 rows, sorted by descending ID. */
export function relationPage<T extends { id: number }>(rows: T[], limit: number, map: (row: T) => EntityRelationItem): EntityRelationPage {
  const shown = rows.slice(0, limit);
  return { items: shown.map(map), hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? encodeRelationCursor(shown[shown.length - 1].id) : null };
}
