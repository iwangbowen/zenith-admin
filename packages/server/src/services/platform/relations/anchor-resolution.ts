import type { CanonicalEntityType } from '@zenith/shared/platform';
import { runWithCurrentUser } from '../../../lib/context';
import { assertRelationBudget } from './runtime';
import type { EntityAnchorResolver, RelationAccessContext, VisibleEntityAnchor } from './types';

export const anchorRefKey = (ref: VisibleEntityAnchor['ref']) => `${ref.type}:${ref.type === 'platform.managed-file' ? ref.key.toLowerCase() : ref.key}`;

/** One load per entity type on the request transaction, including negative visibility caching. */
export async function resolveAnchorBatch(
  resolvers: ReadonlyMap<CanonicalEntityType, EntityAnchorResolver>,
  refs: readonly VisibleEntityAnchor['ref'][],
  access: RelationAccessContext,
  canUse: (type: CanonicalEntityType) => Promise<boolean>,
): Promise<Map<string, VisibleEntityAnchor>> {
  const cache = access.anchorCache ?? new Map<string, VisibleEntityAnchor | null>();
  const groups = new Map<CanonicalEntityType, Map<string, string>>();
  for (const ref of refs) {
    const cacheKey = anchorRefKey(ref);
    if (cache.has(cacheKey)) continue;
    const group = groups.get(ref.type) ?? new Map();
    group.set(cacheKey, ref.key); groups.set(ref.type, group);
  }
  // A transaction owns one connection: batching reduces SQL round trips, parallel awaits do not.
  for (const [type, keys] of groups) {
    assertRelationBudget(access);
    const resolver = resolvers.get(type);
    const rows = resolver && await canUse(type)
      ? await runWithCurrentUser(access.user, () => resolver.resolveMany([...keys.values()], access)) : [];
    assertRelationBudget(access);
    for (const key of keys.keys()) cache.set(key, null);
    for (const anchor of rows) {
      const key = anchorRefKey(anchor.ref);
      if (anchor.ref.type === type && keys.has(key)) cache.set(key, { ...anchor, title: anchor.title.slice(0, 160) });
    }
  }
  const visible = new Map<string, VisibleEntityAnchor>();
  for (const ref of refs) {
    const key = anchorRefKey(ref);
    const anchor = cache.get(key);
    if (anchor) visible.set(key, anchor);
  }
  return visible;
}
