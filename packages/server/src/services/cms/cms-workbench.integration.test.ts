import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { renderCmsWorkbenchPreviewSchema } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import { initializeCmsContentWorkingCopy } from './cms-content-revisions.service';
import { renderCmsWorkbenchPreview } from './cms-workbench-preview.service';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? postgres(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });

describe.skipIf(!connection)('CMS workbench PostgreSQL isolation', () => {
  it('renders saved drafts without changing public data, revisions, counters or schemas; rejects a stale preview context', async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires a migrated disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback preview fixtures');
    try {
      await testDb.transaction(async (tx) => withDbExecutor(tx, async () => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx.insert(schema.users).values({ username: `qa-preview-${suffix}`, nickname: 'Preview QA', password: 'unused' }).returning();
        await runWithCurrentUser({ userId: user.id, username: user.username, roles: ['super_admin'], tenantId: null }, async () => {
          const [site] = await tx.insert(schema.cmsSites).values({ name: 'QA Preview isolation', code: `qa-preview-${suffix}`, theme: 'default', settings: {} }).returning();
          const [other] = await tx.insert(schema.cmsSites).values({ name: 'QA Other', code: `qa-other-${suffix}`, theme: 'default' }).returning();
          const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, name: 'News', code: 'news', slug: 'news', path: 'news' }).returning();
          const [content] = await tx.insert(schema.cmsContents).values({ siteId: site.id, channelId: channel.id, title: 'Saved working title', slug: 'working', body: '<p>Preview body</p>', status: 'draft' }).returning();
          const copy = await initializeCmsContentWorkingCopy(tx, content);
          const before = await tx.execute(sql`SELECT (SELECT count(*) FROM public.cms_content_revisions) AS revisions, (SELECT count(*) FROM public.cms_deployments) AS deployments, (SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'cms_generation_%') AS schemas`);
          const input = renderCmsWorkbenchPreviewSchema.parse({ siteId: site.id, mode: 'working', path: `/@content/${content.id}`, contentIds: [content.id], includeSiteConfiguration: true });
          const result = await renderCmsWorkbenchPreview(input);
          expect(result.status).toBe(200);
          expect(result.html).toContain('Saved working title');
          expect(result.path).toBe('/news/working.html');
          expect(result.contentVersions).toEqual([{ id: content.id, version: 1 }]);
          const after = await tx.execute(sql`SELECT (SELECT count(*) FROM public.cms_content_revisions) AS revisions, (SELECT count(*) FROM public.cms_deployments) AS deployments, (SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'cms_generation_%') AS schemas`);
          expect(after).toEqual(before);
          const [unchanged] = await tx.select().from(schema.cmsContents).where(eq(schema.cmsContents.id, content.id));
          expect(unchanged).toMatchObject({ status: 'draft', viewCount: 0 });
          expect((await tx.select().from(schema.cmsContentWorkingCopies).where(eq(schema.cmsContentWorkingCopies.contentId, content.id)))[0].snapshot).toEqual(copy.snapshot);
          await expect(renderCmsWorkbenchPreview({ ...input, siteId: other.id })).rejects.toMatchObject({ status: 404 });
          await tx.update(schema.cmsContentWorkingCopies).set({ version: 2, snapshot: { ...copy.snapshot, title: 'Changed after preview' } }).where(eq(schema.cmsContentWorkingCopies.contentId, content.id));
          await expect(renderCmsWorkbenchPreview({ ...input, expectedFingerprint: result.fingerprint })).rejects.toMatchObject({ status: 409 });
          await expect(renderCmsWorkbenchPreview({ ...input, mode: 'online', includeSiteConfiguration: false, contentIds: [] })).rejects.toMatchObject({ status: 404 });
        });
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
  }, 90_000);
});
