import { randomUUID } from 'node:crypto';
import { createPgClient } from '../../db/client';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { CmsTelemetryConversionContext, CmsTelemetryPageContext } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { signCmsTelemetryPage } from './cms-telemetry-context';
import { drainCmsTelemetryOutbox, drainCmsTelemetryAttributions, enqueueCmsTelemetryConversion, cmsTelemetryRetryDelayMs } from './cms-telemetry-business';

const connection=process.env.TEST_DATABASE_URL;
const client=connection?createPgClient(connection,{max:1,onnotice:()=>undefined}):null;
afterAll(async()=>{await client?.end();});
describe.skipIf(!connection)('CMS business telemetry transactional outbox',()=>{
  it('rolls back with the business transaction, retries failures, deduplicates delivery and derives the last trusted origin',async()=>{
    const url=new URL(connection!);
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/zenith_review')throw new Error('Requires disposable local zenith_review database');
    const testDb=drizzle(client!,{schema,casing:'snake_case'});const rollback=new Error('rollback outbox fixture');
    try{
      await testDb.transaction(async tx=>withDbExecutor(tx,async()=>{
        expect([1,2,3,12].map(cmsTelemetryRetryDelayMs)).toEqual([5000,10000,20000,3600000]);
        const suffix=randomUUID().slice(0,8);const siteKey=`qa-business-${suffix}`;
        const [site]=await tx.insert(schema.cmsSites).values({code:siteKey,name:siteKey,theme:'default',settings:{analyticsSiteKey:siteKey,telemetry:{enabled:true,schemaVersion:2,timeZone:'Asia/Shanghai'}}}).returning();
        await tx.insert(schema.analyticsSites).values({siteKey,appId:siteKey,name:siteKey});
        const [release]=await tx.insert(schema.cmsReleases).values({siteId:site.id,name:'QA release'}).returning();
        const [deployment]=await tx.insert(schema.cmsDeployments).values({siteId:site.id,releaseId:release.id,status:'active',activatedAt:new Date()}).returning();
        await tx.insert(schema.cmsSiteGenerations).values({siteId:site.id,activeGenerationId:deployment.id});
        const generation=sql.identifier(`cms_generation_${deployment.id}`);
        await tx.execute(sql`create schema ${generation}`);
        await tx.execute(sql`create table ${generation}.cms_site_projection (id integer, settings jsonb)`);
        await tx.execute(sql`insert into ${generation}.cms_site_projection values (${site.id},${JSON.stringify(site.settings)}::jsonb)`);
        const page:CmsTelemetryPageContext={version:2,siteId:site.id,siteKey,environment:'live',canonicalPath:'/contact/',pageType:'page',contentId:null,channelId:2,revisionId:null,contentType:null,contentTitle:null,channelName:'Contact',author:null,releaseId:release.id,deploymentId:deployment.id};
        const context:CmsTelemetryConversionContext={contextToken:signCmsTelemetryPage(page).contextToken,visitorId:randomUUID(),sessionId:randomUUID(),pageViewId:randomUUID(),entryPath:'/news/first.html',entrySource:'newsletter',lastContentId:999999,utm:{source:'newsletter',campaign:'qa'}};
        const props={cmsSiteId:site.id,cmsSchemaVersion:2,trustedCms:true,environment:'live',visitorId:context.visitorId,sessionId:context.sessionId};
        const now=Date.now();const searchId=randomUUID();
        await tx.insert(schema.userEvents).values([
          {eventId:randomUUID(),eventType:'page_view',eventName:'cms.page_view',pagePath:'/news/trusted.html',createdAt:new Date(now-5000),properties:{...props,pageViewId:randomUUID(),contentId:101,contentTitle:'Trusted article',channelId:201,channelName:'Culture',author:'QA Author',contentType:'article',revisionId:301,releaseId:release.id,deploymentId:deployment.id}},
          {eventId:randomUUID(),eventType:'page_view',eventName:'cms.page_view',pagePath:'/news/forged.html',createdAt:new Date(now-1000),properties:{...props,trustedCms:false,contentId:999999}},
          {eventId:randomUUID(),eventType:'custom',eventName:'cms.search_click',pagePath:'/search',createdAt:new Date(now-6000),properties:{...props,targetContentId:101,searchId,keyword:'culture',resultCount:3}},
        ]);
        const abort=new Error('abort business');
        await expect(tx.transaction(async nested=>{await enqueueCmsTelemetryConversion(nested,site.id,'form','aborted',context,null,'form:5');throw abort;})).rejects.toBe(abort);
        expect(await tx.$count(schema.cmsTelemetryOutbox,eq(schema.cmsTelemetryOutbox.siteId,site.id))).toBe(0);
        await enqueueCmsTelemetryConversion(tx,site.id,'form','success',context,null,'form:5','Readers');
        await enqueueCmsTelemetryConversion(tx,site.id,'form','success',context,null,'form:5','Readers');
        await enqueueCmsTelemetryConversion(tx,site.id,'vote','invalid-context',{visitorId:'forged'},null,'interaction:8','Vote');
        expect(await tx.$count(schema.cmsTelemetryOutbox,eq(schema.cmsTelemetryOutbox.siteId,site.id))).toBe(2);
        const result=await drainCmsTelemetryOutbox({concurrency:1});expect(result.failed).toBe(0);expect(result.delivered).toBeGreaterThanOrEqual(2);
        const events=await tx.select().from(schema.userEvents).where(sql`${schema.userEvents.properties}->>'cmsSiteId'=${String(site.id)} and ${schema.userEvents.source}='server'`);
        expect(events).toHaveLength(2);
        const success=events.find(row=>row.eventName==='cms.form_complete')!;
        expect(success.properties).toMatchObject({trustedCms:true,visitorId:context.visitorId,formId:'5'});
        expect(success.properties).not.toHaveProperty('originContentId');
        await drainCmsTelemetryAttributions();
        const [initialAttribution]=await tx.select().from(schema.cmsTelemetryAttributions).where(eq(schema.cmsTelemetryAttributions.eventId,success.eventId!));
        expect(initialAttribution.origin).toMatchObject({originContentId:101,originContentTitle:'Trusted article',originChannelId:201,originAuthor:'QA Author',searchId,keyword:'culture'});
        expect(initialAttribution.settledAt).toBeNull();
        // A later-arriving visit happened before the success; recalculate only the derived row.
        await tx.insert(schema.userEvents).values({eventId:randomUUID(),eventType:'page_view',eventName:'cms.page_view',pagePath:'/news/late.html',createdAt:new Date(now-500),properties:{...props,contentId:102,contentTitle:'Late arrival',channelId:201}});
        await tx.update(schema.cmsTelemetryAttributions).set({nextRecomputeAt:new Date()}).where(eq(schema.cmsTelemetryAttributions.eventId,success.eventId!));
        await drainCmsTelemetryAttributions();
        const [lateAttribution]=await tx.select().from(schema.cmsTelemetryAttributions).where(eq(schema.cmsTelemetryAttributions.eventId,success.eventId!));
        expect(lateAttribution.origin).toMatchObject({originContentId:102,originContentTitle:'Late arrival'});
        expect(lateAttribution.origin).not.toHaveProperty('searchId');
        expect((await tx.select().from(schema.userEvents).where(eq(schema.userEvents.eventId,success.eventId!)))[0].properties).toEqual(success.properties);
        const invalid=events.find(row=>row.eventName==='cms.vote_complete')!;
        expect(invalid.anonymousId).toBeNull();expect(invalid.sessionId).toBeNull();expect(invalid.properties).toMatchObject({entrySource:'unattributed',attributionReason:'missing_or_invalid_context'});
        expect(invalid.properties).not.toHaveProperty('visitorId');
        const [outbox]=await tx.select().from(schema.cmsTelemetryOutbox).where(eq(schema.cmsTelemetryOutbox.eventId,success.eventId!));
        await tx.update(schema.cmsTelemetryOutbox).set({deliveredAt:null}).where(eq(schema.cmsTelemetryOutbox.id,outbox.id));
        const duplicate=await drainCmsTelemetryOutbox({concurrency:1});expect(duplicate.duplicates).toBeGreaterThanOrEqual(1);
        expect(await tx.$count(schema.userEvents,eq(schema.userEvents.eventId,success.eventId!))).toBe(1);
        await enqueueCmsTelemetryConversion(tx,site.id,'form','retry',context,2147483647,'form:5');
        const failed=await drainCmsTelemetryOutbox({concurrency:1});expect(failed.failed).toBeGreaterThanOrEqual(1);
        const [pending]=await tx.select().from(schema.cmsTelemetryOutbox).where(sql`${schema.cmsTelemetryOutbox.siteId}=${site.id} and ${schema.cmsTelemetryOutbox.payload}->>'referenceId'='retry'`);
        expect(pending.deliveredAt).toBeNull();expect(pending.attempts).toBe(1);expect(pending.lastError).toBeTruthy();
        expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        expect((await drainCmsTelemetryOutbox({concurrency:1})).failed).toBe(0); // backoff prevents immediate poison-message loops
        await tx.update(schema.cmsTelemetryOutbox).set({payload:{...pending.payload,memberId:null},nextAttemptAt:new Date()}).where(eq(schema.cmsTelemetryOutbox.id,pending.id));
        expect((await drainCmsTelemetryOutbox({concurrency:1})).failed).toBe(0);
        expect((await tx.select().from(schema.cmsTelemetryOutbox).where(eq(schema.cmsTelemetryOutbox.id,pending.id)))[0].deliveredAt).not.toBeNull();
        // The worker drains multiple batches, recovers abandoned leases and skips active leases.
        const batchPayload={...pending.payload,memberId:null,context:null,page:null};
        await tx.insert(schema.cmsTelemetryOutbox).values(Array.from({length:105},(_,i)=>({siteId:site.id,eventId:randomUUID(),payload:{...batchPayload,referenceId:`batch-${i}`}})));
        const [leased]=await tx.insert(schema.cmsTelemetryOutbox).values({siteId:site.id,eventId:randomUUID(),payload:{...batchPayload,referenceId:'active-lease'},leaseOwner:randomUUID(),leaseExpiresAt:new Date(Date.now()+60000)}).returning();
        expect((await drainCmsTelemetryOutbox({concurrency:1})).delivered).toBe(105);
        expect((await tx.select().from(schema.cmsTelemetryOutbox).where(eq(schema.cmsTelemetryOutbox.id,leased.id)))[0].deliveredAt).toBeNull();
        await tx.update(schema.cmsTelemetryOutbox).set({leaseExpiresAt:new Date(Date.now()-1000)}).where(eq(schema.cmsTelemetryOutbox.id,leased.id));
        expect((await drainCmsTelemetryOutbox({concurrency:1})).delivered).toBe(1);
        // Repeated poison messages stop automatically and leave a recoverable failure record.
        const [poison]=await tx.insert(schema.cmsTelemetryOutbox).values({siteId:site.id,eventId:randomUUID(),payload:{...batchPayload,referenceId:'poison',memberId:2147483647},consecutiveFailures:11}).returning();
        expect((await drainCmsTelemetryOutbox({concurrency:1})).failed).toBe(1);
        const [dead]=await tx.select().from(schema.cmsTelemetryOutbox).where(eq(schema.cmsTelemetryOutbox.id,poison.id));
        expect(dead.deadLetterAt).not.toBeNull();expect(dead.consecutiveFailures).toBe(12);
        expect((await drainCmsTelemetryOutbox({concurrency:1})).failed).toBe(0);
        throw rollback;
      }));
    }catch(error){if(error!==rollback)throw error;}
  },60000);
});
