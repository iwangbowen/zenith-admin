import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createPgClient } from '../../db/client';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, describe, expect, it } from 'vitest';
import { cmsStatReportQuery, cmsStatsQuery } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import { getCmsStatsOverview, getCmsStatsReport, getCmsStatsQuality } from './cms-stats-query';

const connection=process.env.TEST_DATABASE_URL;
const client=connection?createPgClient(connection,{max:1,onnotice:()=>undefined}):null;
afterAll(async()=>{await client?.end();});
describe.skipIf(!connection)('CMS v2 statistics PostgreSQL reconciliation',()=>{
  it('reconciles identities, time zones, engagement snapshots, bot/preview exclusions and complete pagination',async()=>{
    const target=new URL(connection!);
    if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.pathname!=='/zenith_review')throw new Error('Requires disposable local zenith_review database');
    const testDb=drizzle(client!,{schema,casing:'snake_case'});
    const rollback=new Error('rollback CMS statistics fixtures');
    try{
      await testDb.transaction(async tx=>withDbExecutor(tx,async()=>{
        const suffix=randomUUID().slice(0,8);
        const [user]=await tx.insert(schema.users).values({username:`qa-stats-${suffix}`,nickname:'Stats QA',password:'unused',userDataScope:'all'}).returning();
        const [site]=await tx.insert(schema.cmsSites).values({code:`qa-stats-${suffix}`,name:'QA statistics',theme:'default',settings:{telemetry:{enabled:true,schemaVersion:2,timeZone:'Asia/Shanghai'}}}).returning();
        const [other]=await tx.insert(schema.cmsSites).values({code:`qa-stats-other-${suffix}`,name:'QA other statistics',theme:'default',settings:{}}).returning();
        const record=(name:string,visitor:string,page:string,extra:Record<string,unknown>={},at='2026-01-01T23:00:00Z'):typeof schema.userEvents.$inferInsert=>({
          eventId:randomUUID(),eventType:name==='cms.page_view'?'page_view':'custom',eventName:name,pagePath:'/news/test.html',
          anonymousId:visitor,sessionId:`session-${visitor}`,appId:`cms-${site.id}`,ip:'192.0.2.1',deviceType:'desktop',createdAt:new Date(at),
          properties:{cmsSchemaVersion:2,cmsSiteId:site.id,trustedCms:true,environment:'live',visitorId:visitor,sessionId:`session-${visitor}`,pageViewId:page,contentId:1,contentTitle:'Frozen content',channelId:1,channelName:'News',...extra},
        });
        await tx.insert(schema.userEvents).values([
          record('cms.page_view','a','page-a',{isNewVisitor:true}),
          record('cms.page_view','b','page-b',{},'2026-01-02T01:00:00Z'),
          record('cms.engagement','a','page-a',{activeMs:5000,scrollDepth:40}),
          record('cms.engagement','a','page-a',{activeMs:12000,scrollDepth:80}),
          record('cms.read','a','page-a'),
          record('cms.form_complete','a','page-a',{formId:1}),
          record('cms.component_impression','a','page-a',{componentId:'hero',componentSlot:'home.hero'}),
          record('cms.component_click','a','page-a',{componentId:'hero',componentSlot:'home.hero'}),
          record('cms.component_click','a','page-a',{componentId:'hero',componentSlot:'home.hero'}),
          record('cms.page_view','preview','page-preview',{environment:'preview'}),
          record('cms.page_view','legacy','page-legacy',{cmsSchemaVersion:1}),
          record('cms.page_view','untrusted','page-untrusted',{trustedCms:false}),
          record('cms.page_view','other','page-other',{cmsSiteId:other.id}),
          {...record('cms.page_view','bot','page-bot'),deviceType:'bot'},
          record('cms.page_view','before','page-before',{},'2026-01-01T15:59:59Z'),
          record('cms.page_view','end','page-end',{},'2026-01-02T16:00:00Z'),
          ...Array.from({length:25},(_,i)=>record('cms.search','a','page-a',{searchId:`search-${i}`,keyword:`keyword-${i}`,resultCount:0})),
          record('cms.search_click','a','page-a',{searchId:'search-0',keyword:'keyword-0',resultCount:0,targetContentId:1},'2026-01-01T22:59:00Z'),
        ]);
        await runWithCurrentUser({userId:user.id,username:user.username,roles:['super_admin'],tenantId:null},async()=>{
          const query=cmsStatsQuery.parse({siteId:site.id,startTime:'2026-01-02',endTime:'2026-01-02',compare:'none'});
          const overview=await getCmsStatsOverview(query);
          const incompleteComparison=await getCmsStatsOverview({...query,compare:'previous_period'});
          expect(incompleteComparison.previousMetrics).toBeNull();expect(incompleteComparison.comparisonAvailable).toBe(false);expect(incompleteComparison.comparisonUnavailableReason).toBeTruthy();
          expect(overview.metrics).toMatchObject({pv:2,uv:2,sessions:2,newVisitors:1,returningVisitors:1,reads:1,activeMs:12000,avgActiveMs:6000,avgScrollDepth:40,engagedSessions:1,engagementRate:50,bounceRate:50,conversions:1,conversionVisitors:1,conversionRate:50,searches:25,noResultSearches:25,uniqueKeywords:25,noResultKeywords:25});
          expect(overview.trend).toEqual([{date:'2026-01-02',pv:2,uv:2,sessions:2,reads:1,conversions:1,searches:25}]);
          expect(overview.metrics).toMatchObject({impressions:1,clicks:2,ctr:100});
          const first=await getCmsStatsReport(cmsStatReportQuery.parse({...query,dimension:'search',page:1,pageSize:20,sortBy:'searches'}));
          const second=await getCmsStatsReport(cmsStatReportQuery.parse({...query,dimension:'search',page:2,pageSize:20,sortBy:'searches'}));
          expect(first.total).toBe(25);expect(first.list).toHaveLength(20);expect(second.list).toHaveLength(5);
          expect(new Set([...first.list,...second.list].map(row=>row.key)).size).toBe(25);
          expect(first.list.every(row=>row.uv===1&&row.searches===1)).toBe(true);
          expect([...first.list,...second.list].find(row=>row.key==='keyword-0')).toMatchObject({reads:1,conversions:1,searchClicks:1});
          const content=await getCmsStatsReport(cmsStatReportQuery.parse({...query,dimension:'content'}));
          expect(content.list[0]).toMatchObject({key:'1',label:'Frozen content',pv:2,uv:2,activeMs:12000});
          await tx.insert(schema.userEvents).values(record('cms.engagement','a','page-a',{activeMs:2000},'2026-01-01T15:59:00Z'));
          const afterBoundary=await getCmsStatsOverview(query);
          expect(afterBoundary.metrics).toMatchObject({pv:2,activeMs:10000,avgActiveMs:5000});
          await tx.insert(schema.userEvents).values(record('cms.search_click','a','page-a',{searchId:'search-1',keyword:'keyword-1',resultCount:0,targetContentId:1,receivedAt:new Date(Date.parse(overview.scope.watermark)+1).toISOString()},'2026-01-01T22:59:30Z'));
          const frozen=await getCmsStatsReport(cmsStatReportQuery.parse({...query,dimension:'search',watermark:overview.scope.watermark,pageSize:200}));
          expect(frozen.list.find(row=>row.key==='keyword-0')).toMatchObject({reads:1,conversions:1});
          expect(frozen.list.find(row=>row.key==='keyword-1')?.reads).toBe(0);
          const latest=await getCmsStatsReport(cmsStatReportQuery.parse({...query,dimension:'search',pageSize:200}));
          expect(latest.list.find(row=>row.key==='keyword-1')).toMatchObject({reads:1,conversions:1});
          const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: suffix }).returning();
          const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, status: 'active', activatedAt: new Date(), snapshot: { tables: { cms_sites: [{ count: 1, hash: 'manifest-only' }] }, revisions: [], sitePublicRevision: 1, createdAt: new Date().toISOString() } }).returning();
          await tx.insert(schema.cmsSiteGenerations).values({ siteId: site.id, activeGenerationId: deployment.id });
          const generation = sql.identifier(`cms_generation_${deployment.id}`);
          await tx.execute(sql`create schema ${generation}`);
          await tx.execute(sql`create table ${generation}.cms_site_projection (id integer, settings jsonb)`);
          await tx.execute(sql`insert into ${generation}.cms_site_projection values (${site.id},${JSON.stringify(site.settings)}::jsonb)`);
          expect(await getCmsStatsQuality(query)).toMatchObject({ configuredEnabled: true, publishedEnabled: true, status: 'empty' });
          const quality = await getCmsStatsQuality(query);
          const filteredQuality = await getCmsStatsQuality({ ...query, contentId: 987654, author: 'not-an-author', source: 'no-source', device: 'mobile' });
          expect(filteredQuality.eventTypes).toEqual(quality.eventTypes);
          expect(filteredQuality.eventsWithoutPage).toBe(quality.eventsWithoutPage);
          // A conversion's derived attribution can move without mutating the business fact.
          const [conversion] = await tx.select().from(schema.userEvents).where(sql`event_name='cms.form_complete' and properties->>'cmsSiteId'=${String(site.id)}`);
          await tx.insert(schema.cmsTelemetryAttributions).values({ eventId: conversion.eventId!, siteId: site.id, status: 'matched', computedAt: new Date(), origin: { originContentId: 42, originContentTitle: 'Late attributed content' }, nextRecomputeAt: new Date() });
          const attributed = await getCmsStatsReport(cmsStatReportQuery.parse({ ...query, dimension: 'content' }));
          expect(attributed.list.find(row => row.key === '42')).toMatchObject({ label: 'Late attributed content', conversions: 1 });
          const [untouched] = await tx.select().from(schema.userEvents).where(eq(schema.userEvents.id, conversion.id));
          expect(untouched.properties).toEqual(conversion.properties);
          await tx.insert(schema.cmsCollectionStates).values({ siteId: site.id, enabled: true, knownSince: new Date('2025-01-01T00:00:00Z') });
          await tx.insert(schema.cmsCollectionTransitions).values({ siteId: site.id, enabled: true, reason: 'test', createdAt: new Date('2025-01-01T00:00:00Z') });
          expect((await getCmsStatsOverview({ ...query, compare: 'previous_period' })).comparisonAvailable).toBe(true);
          await tx.insert(schema.cmsCollectionTransitions).values({ siteId: site.id, enabled: false, reason: 'test', createdAt: new Date('2026-01-01T00:00:00Z') });
          expect((await getCmsStatsOverview({ ...query, compare: 'previous_period' })).comparisonUnavailableReason).toContain('暂停');

          await tx.update(schema.cmsSites).set({ settings: { telemetry: { enabled: false, schemaVersion: 2, timeZone: 'Asia/Shanghai' } } }).where(eq(schema.cmsSites.id,site.id));
          expect((await getCmsStatsQuality(query)).status).toBe('pending_publication');

        });
        throw rollback;
      }));
    }catch(error){if(error!==rollback)throw error;}
  },60000);
});
