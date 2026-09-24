import { stableStringify } from '../core/json';

const AUDIT_FIELDS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'created_at', 'updated_at', 'created_by', 'updated_by', 'version', 'viewCount', 'likeCount', 'favoriteCount', 'view_count', 'like_count', 'favorite_count']);
/** Only business fields are compared; array ordering remains meaningful for navigation and blocks. */
export function cmsReleaseFieldDiffs(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const fields: { path: string; before: unknown; after: unknown }[] = [];
  for (const key of [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()) {
    if (AUDIT_FIELDS.has(key)) continue;
    const left = before?.[key] ?? null; const right = after?.[key] ?? null;
    if (stableStringify(left) !== stableStringify(right)) fields.push({ path: key, before: left, after: right });
  }
  return fields;
}
