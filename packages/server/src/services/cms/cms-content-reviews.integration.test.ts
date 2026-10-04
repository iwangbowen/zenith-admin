import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { afterAll, describe, expect, it } from 'vitest';
import { saveCmsContentReviewPolicySchema } from '@zenith/shared/cms';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import { getTaskHandler, type TaskRunContext } from '../../lib/task-center';
import { freezeCmsContentRevision, initializeCmsContentWorkingCopy } from './cms-content-revisions.service';
import { completeCmsContentReview, getCmsContentReviewPolicy, listCmsContentReviewRecords, loadCmsLiveReviewSubject, saveCmsContentReviewPolicy } from './cms-content-reviews.service';
import { CMS_CONTENT_REVIEW_TASK, registerCmsContentReviewTaskHandler } from './cms-content-review-tasks';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });
describe.skipIf(!connection)('CMS content review PostgreSQL lifecycle', () => {
  it('binds review records to the online revision, protects CAS and creates idempotent review tasks', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' }); const rollback = new Error('rollback content review fixtures');
    try {
      await testDb.transaction(async tx => withDbExecutor(tx, async () => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx.insert(schema.users).values({ username: `qa-reviews-${suffix}`, nickname: 'Review QA', password: 'unused', userDataScope: 'all' }).returning();
        await runWithCurrentUser({ userId: user.id, username: user.username, roles: ['super_admin'], tenantId: null }, async () => {
          const [site] = await tx.insert(schema.cmsSites).values({ name: 'QA Review', code: `qa-review-${suffix}` }).returning();
          const [channel] = await tx.insert(schema.cmsChannels).values({ siteId: site.id, code: 'news', slug: 'news', path: 'news', name: 'News' }).returning();
          const [content] = await tx.insert(schema.cmsContents).values({ siteId: site.id, channelId: channel.id, title: '在线稿件', slug: 'guide', body: '<p>已发布说明</p>', status: 'published' }).returning();
          const working = await initializeCmsContentWorkingCopy(tx, content);
          const published = await freezeCmsContentRevision(tx, content, working, 'checkpoint');
          await tx.insert(schema.cmsContentRevisionApprovals).values({ revisionId: published.id, hash: published.hash });
          await tx.update(schema.cmsContentWorkingCopies).set({ snapshot: { ...working.snapshot, title: '未发布的新标题' }, publishedRevisionId: published.id }).where(eq(schema.cmsContentWorkingCopies.contentId, content.id));
          const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: 'QA Review release' }).returning();
          const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, status: 'active', snapshot: { tables: {}, revisions: [{ contentId: content.id, revisionId: published.id, hash: published.hash }], sitePublicRevision: 1, createdAt: new Date().toISOString() } }).returning();
          await tx.insert(schema.cmsReleaseActivations).values({ siteId: site.id, releaseId: release.id, toGenerationId: deployment.id, action: 'activate', operatorName: 'QA' });
          await tx.insert(schema.cmsSiteGenerations).values({ siteId: site.id, activeGenerationId: deployment.id });
          const generation = sql.identifier(`cms_generation_${deployment.id}`);
          await tx.execute(sql`create schema ${generation}`);
          await tx.execute(sql`create table ${generation}.cms_generation_revision_refs(content_id integer primary key,revision_id integer not null)`);
          await tx.execute(sql`insert into ${generation}.cms_generation_revision_refs values(${content.id},${published.id})`);
          expect((await loadCmsLiveReviewSubject(site.id, content.id))?.title).toBe('在线稿件');
          const policy = await saveCmsContentReviewPolicy(content.id, saveCmsContentReviewPolicySchema.parse({ expectedVersion: 0, enabled: true, ownerId: user.id, intervalDays: 30, nextReviewAt: '2026-01-01 00:00:00', validUntil: '2026-01-01 00:00:00', noticeDays: 7, checkLinks: false, checkAssetRights: false }));
          await expect(saveCmsContentReviewPolicy(content.id, saveCmsContentReviewPolicySchema.parse({ ...policy, expectedVersion: 0 }))).rejects.toMatchObject({ status: 409 });
          await expect(completeCmsContentReview(content.id, { expectedVersion: policy.version, revisionId: published.id + 1, note: '不能确认另一修订' })).rejects.toMatchObject({ status: 409 });
          registerCmsContentReviewTaskHandler();
          const [task] = await tx.insert(schema.asyncTasks).values({ taskType: CMS_CONTENT_REVIEW_TASK, title: 'Review scan', status: 'running', payload: { siteId: site.id, contentId: content.id }, retryDelayMs: 5000 }).returning();
          const context: TaskRunContext = { taskId: task.id, dispatchToken: task.dispatchToken, payload: task.payload, attempt: 1, checkpoint: null, progress: async () => ({ cancelRequested: false }), reportItems: async () => undefined, isCancelRequested: async () => false };
          await getTaskHandler(CMS_CONTENT_REVIEW_TASK)!.run(context);
          const first = await getCmsContentReviewPolicy(content.id);
          expect(first.issues).toHaveLength(2); expect(first.issues[0].kind).toBe('review_due'); expect(first.issues[0].taskId).toBeTruthy();
          await getTaskHandler(CMS_CONTENT_REVIEW_TASK)!.run(context);
          expect((await getCmsContentReviewPolicy(content.id)).issues[0].taskId).toBe(first.issues[0].taskId);
          const completed = await completeCmsContentReview(content.id, { expectedVersion: first.version, revisionId: published.id, note: '已核实当前在线资料仍然准确' });
          expect(completed.version).toBe(first.version + 1); expect(completed.lastReviewedRevisionId).toBe(published.id); expect(completed.issues).toHaveLength(1); expect(completed.issues[0].kind).toBe('validity_expired');
          const records = await listCmsContentReviewRecords(content.id);
          expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ revisionId: published.id, generationId: deployment.id, note: '已核实当前在线资料仍然准确' });
          const [reviewTask] = await tx.select().from(schema.cmsEditorialTasks).where(eq(schema.cmsEditorialTasks.id, first.issues[0].taskId!));
          expect(reviewTask.status).toBe('verified');
          const [history] = await tx.select().from(schema.cmsEditorialTaskHistory).where(sql`task_id=${reviewTask.id} and action='review_confirmed'`);
          expect(history.snapshot).toMatchObject({ reviewRecordId: records[0].id, revisionId: published.id });
          expect((await tx.select().from(schema.cmsContentWorkingCopies).where(eq(schema.cmsContentWorkingCopies.contentId, content.id)))[0].snapshot.title).toBe('未发布的新标题');
        });
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
