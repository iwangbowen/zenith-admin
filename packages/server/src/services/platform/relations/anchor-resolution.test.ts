import { describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import { resolveAnchorBatch, anchorRefKey } from './anchor-resolution';
import { numericAnchorResolver } from './anchor-batch';
import type { EntityAnchorResolver, RelationAccessContext, VisibleEntityAnchor } from './types';

const access = (): RelationAccessContext => ({ user: { userId: 9, username: 'reader', roles: [], tenantId: 7 }, db: {} as RelationAccessContext['db'], anchorCache: new Map() });
const ref = (key: string, type: CanonicalEntityType = 'identity.user') => ({ type, key });
const anchor = (key: string, type: CanonicalEntityType = 'identity.user'): VisibleEntityAnchor => ({ ref: ref(key, type), title: '对象'.repeat(100), tenantId: 7 });

describe('batch anchor resolution', () => {
  it('loads each type once, deduplicates ids and reuses positive and negative visibility within a request', async () => {
    const users = vi.fn(async (ids: number[]) => ids.filter((id) => id !== 2).map((id) => anchor(String(id))));
    const payments = vi.fn(async (ids: number[]) => ids.map((id) => anchor(String(id), 'payment.order')));
    const registry = new Map<CanonicalEntityType, EntityAnchorResolver>([
      ['identity.user', numericAnchorResolver('identity.user', users)], ['payment.order', numericAnchorResolver('payment.order', payments)],
    ]);
    const ctx = access();
    const refs = [...Array.from({ length: 32 }, (_, i) => ref(String(i + 1))), ref('2'), ref('8', 'payment.order')];
    const result = await resolveAnchorBatch(registry, refs, ctx, async () => true);
    expect(users).toHaveBeenCalledTimes(1);
    expect(users.mock.calls[0][0]).toHaveLength(32);
    expect(payments).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(32);
    expect(result.has(anchorRefKey(ref('2')))).toBe(false);
    expect(result.get(anchorRefKey(ref('1')))?.title.length).toBe(160);
    await resolveAnchorBatch(registry, refs, ctx, async () => true);
    expect(users).toHaveBeenCalledTimes(1);
    await resolveAnchorBatch(registry, [ref('2')], access(), async () => true);
    expect(users).toHaveBeenCalledTimes(2); // No cache survives into a different request/principal.
  });
  it('applies licensing before loading, rejects invalid numeric keys and fails closed on infrastructure errors', async () => {
    const load = vi.fn(async () => [anchor('1')]);
    const resolver = numericAnchorResolver('identity.user', load);
    const registry = new Map<CanonicalEntityType, EntityAnchorResolver>([['identity.user', resolver]]);
    expect((await resolveAnchorBatch(registry, [ref('1')], access(), async () => false)).size).toBe(0);
    expect(load).not.toHaveBeenCalled();
    expect(await resolver.resolveMany(['0', '-1', '1x', '2147483648', '01'], access())).toEqual([]);
    expect(await resolver.resolve(ref('1', 'payment.order'), access())).toBeNull();
    expect(load).not.toHaveBeenCalled();
    load.mockRejectedValue(new Error('database unavailable'));
    await expect(resolveAnchorBatch(registry, [ref('1')], access(), async () => true)).rejects.toThrow('database unavailable');
    await expect(resolveAnchorBatch(registry, [ref('1')], { ...access(), deadlineAt: 0 }, async () => true)).rejects.toBeInstanceOf(HTTPException);
  });
});
