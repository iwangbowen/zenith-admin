import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { cmsCollectionDefinitionSchema } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import logger from '../../lib/logger';
import { withCmsGenerationContext } from './cms-generation-context';
import { createCmsGenerationStorage, cmsGenerationSchemaName, hasCmsGenerationTable, readCmsGenerationConfigurationRows, sealCmsGenerationStorage } from './cms-generation-storage.service';
import { readPublicCmsCollection, resolveCmsCollection } from './cms-content-collections.service';
import { inspectCmsReleaseReadiness } from './cms-release-readiness.service';
import { cmsBuildSchema, createCmsBuildStorage, cmsBuildDependencyHashes, dropCmsBuildStorage } from './cms-release-build-storage';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? postgres(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });

describe.skipIf(!connection)('CMS frozen release build inputs', () => {
  it('copies the immutable base and captures runtime inputs separately without changing live data', async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires a migrated disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback build fixtures');
    try {
      await testDb.transaction(async (tx) => {
        const suffix = randomUUID().slice(0, 8);
        const [parent] = await tx.insert(schema.cmsSites).values({ name: 'Inherited custom theme', code: `qa-parent-${suffix}`, theme: 'docs' }).returning();
        const [site] = await tx.insert(schema.cmsSites).values({ name: 'Build snapshot fixture', code: `qa-build-${suffix}`, theme: 'default' }).returning();
        const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, name: 'News', code: 'news', slug: 'news', path: 'news' }).returning();
        const [tag] = await tx.insert(schema.cmsTags).values({ siteId: site.id, name: 'Frozen tag', slug: `frozen-${suffix}` }).returning();
        const [content, otherContent] = await tx.insert(schema.cmsContents).values([
          { siteId: site.id, channelId: channel.id, title: 'Immutable base title', status: 'published', summary: 'Stable explicit summary', body: '<p>Approved base</p>' },
          { siteId: site.id, channelId: channel.id, title: 'Other detail', status: 'published', summary: 'Another summary', body: '<p>Unchanged body</p>' },
        ]).returning();
        const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: 'Build fixture' }).returning();
        const [base] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id }).returning();
        await createCmsGenerationStorage(tx, site.id, base.id);
        await sealCmsGenerationStorage(tx, base.id, []);
        // One-time media-column rollout: old immutable bases lack this newly materialized field.
        await tx.execute(sql.raw(`DROP VIEW "${cmsGenerationSchemaName(base.id)}".cms_contents`));
        await tx.execute(sql.raw(`ALTER TABLE "${cmsGenerationSchemaName(base.id)}".cms_content_projection DROP COLUMN media`));
        await tx.execute(sql.raw(`CREATE VIEW "${cmsGenerationSchemaName(base.id)}".cms_contents AS SELECT * FROM "${cmsGenerationSchemaName(base.id)}".cms_content_projection`));
        // Simulate an older sealed generation: new tables/columns must not be backfilled from working data.
        await tx.execute(sql.raw(`DROP TABLE "${cmsGenerationSchemaName(base.id)}".cms_content_collections`));
        await tx.execute(sql.raw(`DROP TABLE "${cmsGenerationSchemaName(base.id)}".cms_vocabularies`));
        await tx.execute(sql.raw(`ALTER TABLE "${cmsGenerationSchemaName(base.id)}".cms_tags DROP COLUMN vocabulary_id, DROP COLUMN parent_id`));
        const [workingCollection] = await tx.insert(schema.cmsContentCollections).values({ siteId: site.id, name: 'Unselected working collection', code: `working-${suffix}`, definition: cmsCollectionDefinitionSchema.parse({}) }).returning();
        expect(await readCmsGenerationConfigurationRows(tx, base.id, 'cms_content_collections')).toEqual([]);
        expect((await inspectCmsReleaseReadiness(tx, { ...release, baseGenerationId: base.id })).checks).toEqual([]);
        await tx.execute(sql`select set_config('search_path', ${`${cmsGenerationSchemaName(base.id)},public`}, true)`);
        try {
          await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: site.id, generationId: base.id, candidate: false }, async () => {
            expect(await resolveCmsCollection(site.id, workingCollection.id)).toEqual([]);
            await expect(readPublicCmsCollection(site.id, workingCollection.id)).rejects.toMatchObject({ status: 404 });
          }));
        } finally { await tx.execute(sql`select set_config('search_path','public',true)`); }
        await tx.update(schema.cmsContents).set({ title: 'Unrelated newer public title' }).where(eq(schema.cmsContents.id, content.id));
        const [candidate] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id }).returning();
        await createCmsGenerationStorage(tx, site.id, candidate.id, base.id);
        const [newDefinitions] = await tx.execute<{ collections: number; vocabularies: number }>(sql.raw(`SELECT (SELECT count(*)::int FROM "${cmsGenerationSchemaName(candidate.id)}".cms_content_collections) AS collections,(SELECT count(*)::int FROM "${cmsGenerationSchemaName(candidate.id)}".cms_vocabularies) AS vocabularies`));
        expect(newDefinitions).toEqual({ collections: 0, vocabularies: 0 });
        const [copiedTag] = await tx.execute<{ vocabularyId: number | null; parentId: number | null }>(sql`SELECT vocabulary_id AS "vocabularyId",parent_id AS "parentId" FROM ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_tags`)} WHERE id=${tag.id}`);
        expect(copiedTag).toEqual({ vocabularyId: null, parentId: null });
        expect(await hasCmsGenerationTable(tx, base.id, 'cms_content_collections')).toBe(false);
        const [explicit] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id }).returning();
        await createCmsGenerationStorage(tx, site.id, explicit.id, base.id, { replaceAll: ['cms_content_collections'], tables: { cms_content_collections: [{ id: workingCollection.id, site_id: site.id, name: 'Explicit fixed collection', code: workingCollection.code, definition: workingCollection.definition }] } });
        const [fixedCollection] = await tx.execute<{ name: string; version: number }>(sql`SELECT name,version FROM ${sql.raw(`"${cmsGenerationSchemaName(explicit.id)}".cms_content_collections`)} WHERE id=${workingCollection.id}`);
        expect(fixedCollection).toEqual({ name: 'Explicit fixed collection', version: 1 });
        await sealCmsGenerationStorage(tx, explicit.id, []);
        await tx.update(schema.cmsContentCollections).set({ definition: cmsCollectionDefinitionSchema.parse({ excludedIds: [content.id, otherContent.id] }), version: 2 }).where(eq(schema.cmsContentCollections.id, workingCollection.id));
        await tx.execute(sql`select set_config('search_path', ${`${cmsGenerationSchemaName(explicit.id)},public`}, true)`);
        try {
          await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: site.id, generationId: explicit.id, candidate: false }, async () => {
            const publishedCollection = await readPublicCmsCollection(site.id, workingCollection.id);
            expect(publishedCollection.version).toBe(1);
            expect(publishedCollection.items.map(item => item.title).sort()).toEqual(['Immutable base title', 'Other detail']);
          }));
        } finally { await tx.execute(sql`select set_config('search_path','public',true)`); }
        const [frozen] = await tx.execute<{ title: string }>(sql`SELECT title FROM ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_contents`)} WHERE id=${content.id}`);
        expect(frozen.title).toBe('Immutable base title');
        await tx.insert(schema.cmsComments).values({ siteId: site.id, contentId: content.id, nickname: 'Reader', content: 'Before freeze', status: 'approved' });
        await createCmsBuildStorage(tx, site.id, candidate.id);
        const buildAt = new Date('2026-09-25T10:00:00Z');
        const hashes = async () => {
          await tx.execute(sql`select set_config('search_path', ${`${cmsBuildSchema(candidate.id)},${cmsGenerationSchemaName(candidate.id)},public`}, true)`);
          try { return await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: site.id, generationId: candidate.id, candidate: true, buildAt }, () => cmsBuildDependencyHashes(tx, candidate.id, buildAt, 'test-runtime'))); }
          finally { await tx.execute(sql`select set_config('search_path','public',true)`); }
        };
        const before = await hashes();
        await tx.insert(schema.cmsComments).values({ siteId: site.id, contentId: content.id, nickname: 'Reader', content: 'After freeze', status: 'approved' });
        const after = await hashes();
        expect(after.global).toBe(before.global);
        const [comments] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM ${sql.raw(`"${cmsBuildSchema(candidate.id)}".cms_comments`)}`);
        expect(comments.count).toBe(1);
        await tx.execute(sql`UPDATE ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_contents`)} SET body='<p>Only this body changed</p>' WHERE id=${content.id}`);
        const bodyChanged = await hashes();
        expect(bodyChanged.global).toBe(before.global);
        expect(bodyChanged.contents!.collections).toBe(before.contents!.collections);
        expect(bodyChanged.contents!.details.get(content.id)).not.toBe(before.contents!.details.get(content.id));
        expect(bodyChanged.contents!.details.get(otherContent.id)).toBe(before.contents!.details.get(otherContent.id));
        await tx.execute(sql`UPDATE ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_contents`)} SET summary=NULL WHERE id=${content.id}`);
        const fallbackSummary = await hashes();
        expect(fallbackSummary.global).toBe(bodyChanged.global);
        expect(fallbackSummary.contents!.collections).not.toBe(bodyChanged.contents!.collections);
        await tx.execute(sql`INSERT INTO ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_widgets`)} (site_id,name,code,status,published_data) VALUES (${site.id},'Related slot','related','published',${JSON.stringify({ items: [{ id: 'article', sourceType: 'content', sourceId: content.id }] })}::jsonb)`);
        await tx.execute(sql`INSERT INTO ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_widget_refs`)} (site_id,widget_id,owner_type,owner_id,field,renderer_key) SELECT ${site.id},id,'theme_slot',${site.id},'detail.related','list-sidebar' FROM ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_widgets`)} WHERE code='related'`);
        const widgetBefore = await hashes();
        await tx.execute(sql`UPDATE ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_contents`)} SET body='<p>Widget fallback changed</p>' WHERE id=${content.id}`);
        const widgetAfter = await hashes();
        expect(widgetAfter.global).not.toBe(widgetBefore.global);
        await tx.execute(sql`UPDATE ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_contents`)} SET title='New adjacent title' WHERE id=${otherContent.id}`);
        const adjacentChanged = await hashes();
        expect(adjacentChanged.global).not.toBe(widgetAfter.global);
        await sealCmsGenerationStorage(tx, candidate.id, []);
        const sealedBefore = await hashes();
        await tx.update(schema.cmsContents).set({ viewCount: 999, title: 'Live drift after sealing' }).where(eq(schema.cmsContents.id, content.id));
        const sealedAfter = await hashes();
        expect(sealedAfter.global).toBe(sealedBefore.global);
        expect(sealedAfter.contents!.details.get(content.id)).toBe(sealedBefore.contents!.details.get(content.id));
        // A raw default child that inherits a non-default renderer must use the full dependency closure.
        await tx.execute(sql`UPDATE ${sql.raw(`"${cmsBuildSchema(candidate.id)}".cms_sites`)} SET parent_id=${parent.id} WHERE id=${site.id}`);
        await tx.execute(sql`INSERT INTO ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_site_inheritances`)} (site_id,theme) VALUES (${site.id},true)`);
        const inheritedThemeBefore = await hashes();
        expect(inheritedThemeBefore.contents).toBeUndefined();
        await tx.execute(sql`UPDATE ${sql.raw(`"${cmsGenerationSchemaName(candidate.id)}".cms_content_projection`)} SET body='<p>Custom themes may consume any body</p>' WHERE id=${otherContent.id}`);
        const inheritedThemeAfter = await hashes();
        expect(inheritedThemeAfter.global).not.toBe(inheritedThemeBefore.global);
        const [live] = await tx.select().from(schema.cmsContents).where(eq(schema.cmsContents.id, content.id));
        expect(live.title).toBe('Live drift after sealing');
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }, 90_000);
  it('drops only the staging copy and never cascades into objects outside it', async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires a migrated disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback staging drop fixtures');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await testDb.transaction(async (tx) => withDbExecutor(tx, async () => {
        const [site] = await tx.insert(schema.cmsSites).values({ name: 'Staging drop fixture', code: `qa-stage-${randomUUID().slice(0, 8)}` }).returning();
        const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: 'Staging drop fixture' }).returning();
        const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id }).returning();
        await createCmsGenerationStorage(tx, site.id, deployment.id);
        await createCmsBuildStorage(tx, site.id, deployment.id);
        const staging = cmsBuildSchema(deployment.id);
        const present = async () => (await tx.execute<{ present: boolean }>(sql`select exists(select 1 from pg_namespace where nspname=${staging}) as present`))[0].present;
        const external = sql.identifier(`qa_stage_dependency_${deployment.id}`);
        await tx.execute(sql`create view public.${external} as select * from ${sql.identifier(staging)}.cms_comments`);
        await dropCmsBuildStorage(deployment.id);
        expect(await present()).toBe(true);
        expect(warn).toHaveBeenCalledOnce();
        await tx.execute(sql`drop view public.${external}`);
        await dropCmsBuildStorage(deployment.id);
        expect(await present()).toBe(false);
        expect(await hasCmsGenerationTable(tx, deployment.id, 'cms_contents')).toBe(true);
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
    finally { warn.mockRestore(); }
  }, 60_000);
});
