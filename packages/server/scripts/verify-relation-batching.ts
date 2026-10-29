/** Real PostgreSQL batching and tenant regression; all fixtures are transaction-local. */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db, closeDb } from '../src/db';
import { withDbQueryObserver } from '../src/db/query-metrics';
import { runWithCurrentUser } from '../src/lib/context';
import { config } from '../src/config';
import redis from '../src/lib/redis';
import { identityAnchorResolvers } from '../src/services/platform/relations/providers/identity.provider';
import { reverseSubjectProviders } from '../src/services/platform/relations/providers/reverse-subjects.provider';
import { resolveAnchorBatch } from '../src/services/platform/relations/anchor-resolution';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import type { EntityAnchorResolver, RelationAccessContext, VisibleEntityAnchor } from '../src/services/platform/relations/types';

try {
  config.multiTenantMode = true;
  await db.transaction(async (tx) => {
    await tx.execute(sql`create temporary table users (like public.users including defaults) on commit drop`);
    await tx.execute(sql`insert into users (id, username, nickname, password, tenant_id)
      select n, 'batch-' || n, '用户 ' || n, 'unused-regression-value', case when n <= 32 then 7 else 8 end from generate_series(1, 33) n`);
    await tx.execute(sql`create temporary table operation_log_subjects (like public.operation_log_subjects including defaults) on commit drop`);
    await tx.execute(sql`insert into operation_log_subjects (operation_log_id, entity_type, entity_key, role, tenant_id)
      select 41, 'identity.user', n::text, 'related', 7 from generate_series(1,33) n`);
    const user = { userId: 1, username: 'regression', roles: ['super_admin'], tenantId: null, viewingTenantId: 7 };
    const access: RelationAccessContext = { user, db: tx, anchorCache: new Map() };
    const resolvers = new Map<CanonicalEntityType, EntityAnchorResolver>(identityAnchorResolvers.map((entry) => [entry.type, entry]));
    const batch = (refs: readonly VisibleEntityAnchor['ref'][], ctx: RelationAccessContext) => resolveAnchorBatch(resolvers, refs, ctx, async () => true);
    const source: VisibleEntityAnchor = { ref: { type: 'platform.operation-log', key: '41' }, title: '来源', tenantId: 7 };
    const provider = reverseSubjectProviders(['identity.user'], async () => source, batch).find((entry) => entry.sourceType === source.ref.type)!;
    let queries = 0;
    const pages = await runWithCurrentUser(user, () => withDbQueryObserver(() => { queries++; }, async () => {
      const first = await provider.list(source, { limit: 20, access });
      const second = await provider.list(source, { limit: 20, access, cursor: first.nextCursor! });
      return [first, second];
    }));
    const keys = pages.flatMap((page) => page.items.map((item) => item.ref.key));
    assert.equal(keys.length, 32);
    assert.equal(new Set(keys).size, 32);
    assert(!keys.includes('33'));
    assert.equal(pages[1].hasMore, false);
    // First page: subjects + one user batch. Second page reuses 31 cached candidates, then loads at most one new id.
    assert(queries <= 6, `Expected bounded query count, got ${queries}`);
    const foreign = await runWithCurrentUser({ ...user, viewingTenantId: 8 }, () => identityAnchorResolvers[0].resolveMany(['1', '33'], { ...access, user: { ...user, viewingTenantId: 8 }, anchorCache: new Map() }));
    assert.deepEqual(foreign.map((row) => row.ref.key), ['33']);
    process.stdout.write(JSON.stringify({ pages: pages.map((page) => page.items.length), visibleObjects: keys.length, queries, noDuplicatesOrForeignRows: true, separateTenantScope: 'PASS' }) + '\n');
  });
} finally {
  await closeDb(); redis.disconnect();
}
