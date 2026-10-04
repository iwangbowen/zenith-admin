import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import { createCmsContent, updateCmsContent } from './cms-contents-write.service';
import { getCmsContent, listCmsContents } from './cms-contents-query.service';
import { freezeCmsContentRevision, markCmsRevisionPublished, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { cmsContentContract } from '@zenith/shared/cms';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });
describe.skipIf(!connection)('CMS work/publication comparison PostgreSQL lifecycle', () => {
  it('preserves approval on a no-op, ignores owner metadata and keeps list/detail filters consistent', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' }); const rollback = new Error('rollback');
    try { await testDb.transaction(async tx => withDbExecutor(tx, async () => {
      const code = randomUUID().slice(0, 8);
      const [actor] = await tx.insert(schema.users).values({ username: `qa-change-${code}`, password: 'unused', nickname: 'QA', userDataScope: 'all' }).returning();
      await runWithCurrentUser({ userId: actor.id, username: actor.username, roles: ['super_admin'], tenantId: null }, async () => {
        const [site] = await tx.insert(schema.cmsSites).values({ name: 'QA changes', code: `qa-change-${code}` }).returning();
        const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, name: 'News', code: 'news', slug: 'news', path: 'news' }).returning();
        const content = await createCmsContent({ siteId: site.id, channelId: channel.id, title: 'Original', body: '<p>Body</p>' });
        const [identity] = await tx.select().from(schema.cmsContents).where(eq(schema.cmsContents.id, content.id));
        const revision = await freezeCmsContentRevision(tx, identity, await requireCmsWorkingCopy(tx, content.id), 'publication');
        await markCmsRevisionPublished(tx, content.id, revision.id);
        await tx.update(schema.cmsContentWorkingCopies).set({ editorialStatus: 'approved' }).where(eq(schema.cmsContentWorkingCopies.contentId, content.id));
        const before = await getCmsContent(content.id);
        const same = await updateCmsContent(content.id, { expectedVersion: before.version, title: before.title });
        expect(same.editorialStatus).toBe('approved'); expect(same.hasUnpublishedChanges).toBe(false);
        const ownerOnly = await updateCmsContent(content.id, { expectedVersion: same.version, ownerId: actor.id });
        expect(ownerOnly.editorialStatus).toBe('approved'); expect(ownerOnly.hasUnpublishedChanges).toBe(false);
        const changed = await updateCmsContent(content.id, { expectedVersion: ownerOnly.version, title: 'New title' });
        expect(changed.editorialStatus).toBe('draft'); expect(changed.hasUnpublishedChanges).toBe(true);
        const list = await listCmsContents(cmsContentContract.list.query.parse({ siteId: site.id, hasUnpublishedChanges: 'true' }));
        expect(list.list.map(row => row.id)).toEqual([content.id]);
        const restored = await updateCmsContent(content.id, { expectedVersion: changed.version, title: 'Original' });
        expect(restored.hasUnpublishedChanges).toBe(false);
      }); throw rollback;
    })); } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
