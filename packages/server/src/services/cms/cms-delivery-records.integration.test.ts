import { randomUUID } from 'node:crypto';
import { createPgClient } from '../../db/client';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { buildCmsRevisionSnapshot, cmsRevisionHash, initializeCmsContentWorkingCopy } from './cms-content-revisions.service';
import { cmsDeliveryContentPaths, cmsDeliveryRightsPaths } from './cms-delivery-records';
import { createCmsGenerationStorage, sealCmsGenerationStorage } from './cms-generation-storage.service';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });

describe.skipIf(!connection)('CMS delivery paths PostgreSQL projection', () => {
  it('binds single and multiple IDs and uses frozen routes for withdrawals and asset rights changes', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review');
    const review = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback delivery path fixtures');
    try {
      await review.transaction(async tx => {
        const suffix = randomUUID().slice(0, 8);
        const [site] = await tx.insert(schema.cmsSites).values({ name: 'QA delivery routes', code: `qa-delivery-${suffix}` }).returning();
        const [otherSite] = await tx.insert(schema.cmsSites).values({ name: 'QA isolated site', code: `qa-delivery-other-${suffix}` }).returning();
        const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, name: 'Published channel', code: 'news', slug: 'news', path: 'news', detailPathRule: 'none' }).returning();
        const contents = await tx.insert(schema.cmsContents).values(['first', 'second'].map(slug => ({ siteId: site.id, channelId: channel.id, title: slug, slug, status: 'published' as const, body: '<p>Public article</p>' }))).returning();
        const resources = await tx.insert(schema.cmsResources).values(['first', 'second'].map(name => ({ siteId: site.id, name, url: `https://media.example.invalid/${suffix}/${name}.jpg` }))).returning();
        const assets = await tx.insert(schema.cmsAssetVersions).values(resources.map(resource => ({ resourceId: resource.id, siteId: site.id, version: 1, url: resource.url, size: 100, contentHash: 'a'.repeat(64) }))).returning();
        const revisions: schema.CmsDeploymentSnapshot['revisions'] = [];
        for (let index = 0; index < contents.length; index++) {
          const content = contents[index];
          const snapshot = { ...buildCmsRevisionSnapshot(content), assetVersions: { [resources[index].id]: assets[index].id } };
          await initializeCmsContentWorkingCopy(tx, content, snapshot);
          const [revision] = await tx.insert(schema.cmsContentRevisions).values({ contentId: content.id, version: 1, sourceVersion: 1, kind: 'publication', hash: cmsRevisionHash(snapshot), title: content.title, snapshot }).returning();
          await tx.update(schema.cmsContentWorkingCopies).set({ publishedRevisionId: revision.id }).where(eq(schema.cmsContentWorkingCopies.contentId, content.id));
          revisions.push({ contentId: content.id, revisionId: revision.id, hash: revision.hash });
        }
        const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: 'QA published routes' }).returning();
        const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, status: 'active' }).returning();
        await createCmsGenerationStorage(tx, site.id, deployment.id);
        await sealCmsGenerationStorage(tx, deployment.id, revisions);
        await tx.insert(schema.cmsSiteGenerations).values({ siteId: site.id, activeGenerationId: deployment.id });
        // These working edits must never alter the paths checked for the current publication.
        await tx.update(schema.cmsChannels).set({ path: 'unpublished-route', detailPathRule: 'year' }).where(eq(schema.cmsChannels.id, channel.id));
        await tx.update(schema.cmsContents).set({ slug: 'unpublished-slug' }).where(eq(schema.cmsContents.id, contents[0].id));

        expect(await cmsDeliveryContentPaths(tx, site.id, [contents[0].id], 'withdrawn')).toEqual([{ path: '/news/first.html', expectedStatus: 'withdrawn' }]);
        expect((await cmsDeliveryContentPaths(tx, site.id, contents.map(content => content.id), 'visible')).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
          { path: '/news/first.html', expectedStatus: 'visible' }, { path: '/news/second.html', expectedStatus: 'visible' },
        ]);
        expect(await cmsDeliveryContentPaths(tx, site.id, [], 'visible')).toEqual([]);
        expect(await cmsDeliveryContentPaths(tx, otherSite.id, [contents[0].id], 'visible')).toEqual([]);

        const withdrawn = await cmsDeliveryRightsPaths(tx, site.id, [resources[0].id], true);
        expect(withdrawn).toEqual([
          { path: '/news/first.html', expectedStatus: 'withdrawn' },
          { path: `/asset-version/${assets[0].id}`, expectedStatus: 'withdrawn', kind: 'asset', assetUrl: assets[0].url },
        ]);
        const allWithdrawn = await cmsDeliveryRightsPaths(tx, site.id, resources.map(resource => resource.id), true);
        expect(allWithdrawn).toHaveLength(4);
        expect(allWithdrawn).toEqual(expect.arrayContaining(assets.map(asset => ({ path: `/asset-version/${asset.id}`, expectedStatus: 'withdrawn', kind: 'asset', assetUrl: asset.url }))));
        expect((await cmsDeliveryRightsPaths(tx, site.id, resources.map(resource => resource.id), false)).map(item => item.path).sort()).toEqual(['/news/first.html', '/news/second.html']);
        expect(await cmsDeliveryRightsPaths(tx, otherSite.id, [resources[0].id], true)).toEqual([]);
        expect(await cmsDeliveryRightsPaths(tx, site.id, [], true)).toEqual([]);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
