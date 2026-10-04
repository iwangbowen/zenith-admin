import { randomUUID } from 'node:crypto';
import { createPgClient } from '../../db/client';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { CmsTelemetryEvent, CmsTelemetryPageContext } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { collectCmsTelemetry } from './cms-telemetry.service';
import { signCmsTelemetryPage } from './cms-telemetry-context';
import { batchInsertEvents } from '../analytics/analytics.service';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });
describe.skipIf(!connection)('CMS signed telemetry collector PostgreSQL', () => {
  it('deduplicates delivery atomically with the content counter and fences public ingestion', async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const review = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback telemetry collector fixture');
    try {
      await review.transaction(async tx => withDbExecutor(tx, async () => {
        const key = `qa-collector-${randomUUID().slice(0, 8)}`;
        await tx.insert(schema.analyticsSites).values({ siteKey: key, appId: key, name: key });
        const [site] = await tx.insert(schema.cmsSites).values({ code: key, name: key, theme: 'default', settings: { analyticsSiteKey: key, telemetry: { enabled: true, schemaVersion: 2, timeZone: 'Asia/Shanghai' } } }).returning();
        const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, name: 'QA', code: 'qa', slug: 'qa', path: 'qa' }).returning();
        const [content] = await tx.insert(schema.cmsContents).values({ siteId: site.id, channelId: channel.id, title: 'QA collector', status: 'published' }).returning();
        const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: key }).returning();
        const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, status: 'active', activatedAt: new Date() }).returning();
        await tx.insert(schema.cmsSiteGenerations).values({siteId:site.id,activeGenerationId:deployment.id});
        const generation=sql.identifier(`cms_generation_${deployment.id}`);
        await tx.execute(sql`create schema ${generation}`);
        await tx.execute(sql`create table ${generation}.cms_site_projection (id integer, settings jsonb)`);
        await tx.execute(sql`insert into ${generation}.cms_site_projection values (${site.id},${JSON.stringify(site.settings)}::jsonb)`);
        const page: CmsTelemetryPageContext = { version: 2, siteId: site.id, siteKey: key, environment: 'live', canonicalPath: '/qa/slug.html', pageType: 'detail', contentId: content.id, channelId: channel.id, revisionId: null, contentType: 'article', contentTitle: content.title, channelName: channel.name, author: null, deploymentId: deployment.id, releaseId: release.id };
        const contextToken = signCmsTelemetryPage(page).contextToken;
        const event: CmsTelemetryEvent = { eventId: randomUUID(), name: 'cms.page_view', occurredAt: new Date().toISOString(), visitorId: randomUUID(), sessionId: randomUUID(), pageViewId: randomUUID(), properties: { entryPath: '/', entrySource: 'qa', isNewVisitor: true } };
        const request = { ip: '192.0.2.28', userAgent: 'Mozilla/5.0 QA CMS Stats', origin: 'http://localhost:5373', host: 'localhost:5373' };
        const first = await collectCmsTelemetry({ contextToken, events: [event, event] }, request);
        expect(first.acceptedEventIds).toEqual([event.eventId]);
        expect(first.duplicates).toBe(1);
        expect((await collectCmsTelemetry({ contextToken, events: [event] }, request)).duplicates).toBe(1);
        const newEnvelopeId = randomUUID();
        expect((await collectCmsTelemetry({ contextToken, events: [{ ...event, eventId: newEnvelopeId }] }, request)).acceptedEventIds).toEqual([newEnvelopeId]);
        const [projected] = await tx.select().from(schema.cmsContents).where(eq(schema.cmsContents.id, content.id));
        expect(projected.viewCount).toBe(1);
        const [fact] = await tx.select().from(schema.userEvents).where(eq(schema.userEvents.eventId, event.eventId));
        expect(fact.properties).toMatchObject({ cmsSchemaVersion: 2, trustedCms: true, cmsSiteId: site.id, contentId: content.id, canonicalPath: '/qa/slug.html', visitorId: event.visitorId });

        expect((await collectCmsTelemetry({ contextToken: signCmsTelemetryPage({ ...page, environment: 'preview' }).contextToken, events: [{ ...event, eventId: randomUUID() }] }, request)).reason).toBe('preview');
        expect((await collectCmsTelemetry({ contextToken, events: [{ ...event, eventId: randomUUID() }] }, { ...request, userAgent: 'Googlebot' })).reason).toBe('bot');
        await expect(collectCmsTelemetry({ contextToken: contextToken + 'bad', events: [event] }, request)).rejects.toMatchObject({ status: 403 });
        expect((await collectCmsTelemetry({ contextToken, events: [{ ...event, eventId: randomUUID(), occurredAt: new Date(Date.now() - 2 * 86400000).toISOString() }] }, request)).reason).toBe('invalid_event');

        const forgedId = randomUUID();
        await batchInsertEvents([{ eventId: forgedId, eventType: 'page_view', eventName: 'cms.page_view', sessionId: randomUUID(), pagePath: '/', properties: { trustedCms: true, cmsSchemaVersion: 2, cmsSiteId: site.id } }], { ip: request.ip, ua: request.userAgent, siteKey: key, origin: request.origin });
        const [forged] = await tx.select().from(schema.userEvents).where(eq(schema.userEvents.eventId, forgedId));
        expect(forged.properties?.trustedCms).toBeUndefined();
        expect(forged.properties?.cmsSchemaVersion).toBeUndefined();
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
  });
});
