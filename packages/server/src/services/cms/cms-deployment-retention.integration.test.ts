import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import type { TaskRunContext } from '../../lib/task-center';
import { cmsDeploymentDirectory } from './cms-deployment-files';
import { CMS_STATIC_ROOT, isStrictlyWithin } from './cms-static-path';
import { getCmsDeploymentCapacitySummary, previewCmsDeploymentCleanup } from './cms-deployment-retention.service';
import { dispatchCmsDeploymentRetention, purgeCmsDeploymentStorage, registerCmsDeploymentRetentionTasks } from './cms-deployment-retention-tasks';
import { assertCmsDeploymentStorageAvailable } from './cms-deployment-storage-state';

const mocks = vi.hoisted(() => ({ enqueueAsyncTask: vi.fn(async () => undefined) }));
// The fixture transaction is never committed, so queue delivery is observed instead of sent to pg-boss.
vi.mock('../../lib/task-center', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/task-center')>(),
  enqueueAsyncTask: mocks.enqueueAsyncTask,
}));
const connection = process.env.TEST_DATABASE_URL;
const client = connection ? postgres(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });
describe.skipIf(!connection)('CMS deployment storage PostgreSQL recovery', () => {
  it('protects active/pinned/base/delivery references and resumes after the schema step without losing audit records', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' }); const rollback = new Error('rollback deployment retention fixture');
    const siteCode = `qa-retention-${randomUUID().slice(0, 8)}`; const fixtureRoot = path.resolve(CMS_STATIC_ROOT, siteCode);
    if (!isStrictlyWithin(CMS_STATIC_ROOT, fixtureRoot)) throw new Error('Fixture storage boundary rejected');
    try {
      await testDb.transaction(async tx => withDbExecutor(tx, async () => {
        const [user] = await tx.insert(schema.users).values({ username: siteCode, nickname: 'Retention QA', password: 'unused', userDataScope: 'all' }).returning();
        await runWithCurrentUser({ userId: user.id, username: user.username, roles: ['super_admin'], tenantId: null }, async () => {
          const [site] = await tx.insert(schema.cmsSites).values({ name: 'QA retention', code: siteCode }).returning();
          await tx.insert(schema.cmsDeploymentRetentionPolicies).values({ siteId: site.id, retainCount: 10, retainDays: 1, failedRetainDays: 0 });
          const generations: number[] = [];
          for (let index = 0; index < 100; index++) {
            const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: `QA retention ${index}`, status: index === 99 ? 'active' : 'superseded' }).returning();
            const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, status: index === 99 ? 'active' : 'retired', createdAt: new Date(Date.now() - 80 * 86400000), snapshot: { siteCode, tables: {}, revisions: [], sitePublicRevision: 1, createdAt: new Date().toISOString() } }).returning();
            await tx.update(schema.cmsReleases).set({ deploymentId: deployment.id }).where(eq(schema.cmsReleases.id, release.id));
            generations.push(deployment.id);
            const namespace = sql.identifier(`cms_generation_${deployment.id}`);
            await tx.execute(sql`create schema ${namespace}`); await tx.execute(sql`create table ${namespace}.documents(id integer, body text)`);
            const directory = cmsDeploymentDirectory(siteCode, deployment.id); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'index.html'), `deployment ${deployment.id}`);
          }
          await tx.insert(schema.cmsSiteGenerations).values({ siteId: site.id, activeGenerationId: generations[99] });
          await tx.insert(schema.cmsDeploymentStorage).values({ deploymentId: generations[0], pinned: true, siteCode });
          await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: 'Pending base', status: 'draft', baseGenerationId: generations[1] });
          await tx.insert(schema.asyncTasks).values({ taskType: 'cms-delivery-verification', title: 'Pending delivery', retryDelayMs: 1000, payload: { siteId: site.id, deploymentId: generations[2] } });
          const preview = await previewCmsDeploymentCleanup(site.id);
          expect(preview.candidates).toHaveLength(87);
          const protectedIds = [generations[0], generations[1], generations[2], ...generations.slice(90)];
          expect(preview.candidates.every(row => !protectedIds.includes(row.id))).toBe(true);
          const [task] = await tx.insert(schema.asyncTasks).values({ taskType: 'cms-deployment-cleanup', title: 'QA cleanup', status: 'running', retryDelayMs: 1000, payload: { siteId: site.id, deploymentIds: [generations[3]] } }).returning();
          let checks = 0;
          const ctx: TaskRunContext = { taskId: task.id, dispatchToken: task.dispatchToken, payload: task.payload, checkpoint: null, attempt: 1, progress: async () => ({ cancelRequested: false }), reportItems: async () => undefined, isCancelRequested: async () => ++checks >= 2 };
          await expect(purgeCmsDeploymentStorage(site.id, generations[3], ctx)).rejects.toThrow('已停止剩余部署');
          const [partial] = await tx.select().from(schema.cmsDeploymentStorage).where(eq(schema.cmsDeploymentStorage.deploymentId, generations[3]));
          expect(partial.storageState).toBe('purging'); expect(partial.schemaPurgedAt).not.toBeNull(); expect(partial.purgedAt).toBeNull();
          expect(await fs.readFile(path.join(cmsDeploymentDirectory(siteCode, generations[3]), 'index.html'), 'utf8')).toContain('deployment');
          await tx.update(schema.asyncTasks).set({ status: 'cancelled', cancelRequested: true }).where(eq(schema.asyncTasks.id, task.id));
          ctx.isCancelRequested = async () => false;
          const nextDispatch = randomUUID();
          await tx.update(schema.asyncTasks).set({ status: 'running', cancelRequested: false, dispatchToken: nextDispatch }).where(eq(schema.asyncTasks.id, task.id));
          await expect(purgeCmsDeploymentStorage(site.id, generations[3], ctx)).rejects.toThrow('回收执行轮次已变化');
          ctx.dispatchToken = nextDispatch;
          expect(await purgeCmsDeploymentStorage(site.id, generations[3], ctx)).toContain('审计记录保留');
          expect((await tx.select().from(schema.cmsDeploymentStorage).where(eq(schema.cmsDeploymentStorage.deploymentId, generations[3])))[0].storageState).toBe('purged');
          expect(await tx.$count(schema.cmsDeployments, eq(schema.cmsDeployments.id, generations[3]))).toBe(1);
          await expect(assertCmsDeploymentStorageAvailable(tx, generations[3])).rejects.toMatchObject({ status: 409 });
          await expect(fs.stat(cmsDeploymentDirectory(siteCode, generations[3]))).rejects.toMatchObject({ code: 'ENOENT' });
          expect(await fs.readFile(path.join(cmsDeploymentDirectory(siteCode, generations[99]), 'index.html'), 'utf8')).toContain('deployment');
          // An external SQL view must not be removed by DROP SCHEMA CASCADE.
          const external = sql.identifier(`qa_retention_dependency_${site.id}`);
          await tx.execute(sql`create view public.${external} as select * from ${sql.identifier(`cms_generation_${generations[4]}`)}.documents`);
          await expect(purgeCmsDeploymentStorage(site.id, generations[4], ctx)).rejects.toThrow('仍被数据库对象引用');
          expect((await tx.execute<{ present: string }>(sql`select to_regclass(${`public.qa_retention_dependency_${site.id}`})::text as present`))[0].present).toBeTruthy();
          await tx.execute(sql`drop view public.${external}`);
          // Simulate cancellation after the file delete but before the storage completion commit.
          const originalRemove = fs.rm.bind(fs); const interruptedDirectory = cmsDeploymentDirectory(siteCode, generations[4]);
          const remove = vi.spyOn(fs, 'rm').mockImplementation(async (targetPath, options) => {
            await originalRemove(targetPath, options);
            if (String(targetPath) === interruptedDirectory) await tx.update(schema.asyncTasks).set({ status: 'cancelled', cancelRequested: true }).where(eq(schema.asyncTasks.id, task.id));
          });
          try { await expect(purgeCmsDeploymentStorage(site.id, generations[4], ctx)).rejects.toThrow('回收执行轮次已变化'); }
          finally { remove.mockRestore(); }
          const [filesDeleted] = await tx.select().from(schema.cmsDeploymentStorage).where(eq(schema.cmsDeploymentStorage.deploymentId, generations[4]));
          expect(filesDeleted.storageState).toBe('purging'); expect(filesDeleted.filesPurgedAt).toBeNull();
          await expect(fs.stat(interruptedDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
          ctx.dispatchToken = randomUUID();
          await tx.update(schema.asyncTasks).set({ status: 'running', cancelRequested: false, dispatchToken: ctx.dispatchToken }).where(eq(schema.asyncTasks.id, task.id));
          expect(await purgeCmsDeploymentStorage(site.id, generations[4], ctx)).toContain('审计记录保留');
          expect(await tx.$count(schema.cmsDeployments, eq(schema.cmsDeployments.siteId, site.id))).toBe(100);
          const remaining = await previewCmsDeploymentCleanup(site.id);
          expect(remaining.candidates).toHaveLength(85);
          for (const candidate of remaining.candidates) expect(await purgeCmsDeploymentStorage(site.id, candidate.id, ctx)).toContain('审计记录保留');
          expect(await getCmsDeploymentCapacitySummary(site.id)).toMatchObject({ retained: 13, protected: 13, eligible: 0, purged: 87 });
          expect((await previewCmsDeploymentCleanup(site.id)).candidates).toEqual([]);
          expect(await tx.$count(schema.cmsDeployments, eq(schema.cmsDeployments.siteId, site.id))).toBe(100);
          const namespaces = await tx.execute<{ name: string }>(sql`select nspname as name from pg_namespace where nspname in (${sql.join(generations.map(id => sql`${`cms_generation_${id}`}`), sql`,`)})`);
          expect(namespaces.map(row => row.name).sort()).toEqual(protectedIds.map(id => `cms_generation_${id}`).sort());
          expect((await fs.readdir(fixtureRoot)).sort()).toEqual(protectedIds.map(id => `generation-${id}`).sort());
        });
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
    finally { await fs.rm(fixtureRoot, { recursive: true, force: true }); }
  }, 180_000);
  it('submits the daily cleanup for sites without a saved policy and skips explicit opt-outs', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' }); const rollback = new Error('rollback deployment retention dispatch fixture');
    registerCmsDeploymentRetentionTasks();
    try {
      await testDb.transaction(async tx => withDbExecutor(tx, async () => {
        const seedSite = async (label: string) => {
          const [site] = await tx.insert(schema.cmsSites).values({ name: `QA dispatch ${label}`, code: `qa-dispatch-${label}-${randomUUID().slice(0, 8)}` }).returning();
          const generations: number[] = [];
          for (let index = 0; index < 12; index++) {
            const active = index === 11;
            const [release] = await tx.insert(schema.cmsReleases).values({ siteId: site.id, name: `QA dispatch ${label} ${index}`, status: active ? 'active' : 'superseded' }).returning();
            const [deployment] = await tx.insert(schema.cmsDeployments).values({ siteId: site.id, releaseId: release.id, status: active ? 'active' : 'retired', createdAt: new Date(Date.now() - (80 - index) * 86400000) }).returning();
            generations.push(deployment.id);
          }
          await tx.insert(schema.cmsSiteGenerations).values({ siteId: site.id, activeGenerationId: generations[11] });
          return { siteId: site.id, generations };
        };
        const defaults = await seedSite('default'); const optedOut = await seedSite('opt-out');
        await tx.insert(schema.cmsDeploymentRetentionPolicies).values({ siteId: optedOut.siteId, automatic: false });
        await dispatchCmsDeploymentRetention();
        const submitted = (await tx.select({ payload: schema.asyncTasks.payload }).from(schema.asyncTasks).where(eq(schema.asyncTasks.taskType, 'cms-deployment-cleanup')))
          .filter(task => [defaults.siteId, optedOut.siteId].includes(Number(task.payload.siteId)));
        expect(submitted).toHaveLength(1);
        expect(submitted[0].payload).toMatchObject({ siteId: defaults.siteId, automatic: true });
        // Ten most recent deployments (including the active one) stay; only the two oldest are eligible.
        expect([...submitted[0].payload.deploymentIds as number[]].sort((a, b) => a - b)).toEqual(defaults.generations.slice(0, 2));
        expect(mocks.enqueueAsyncTask).toHaveBeenCalled();
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
  }, 60_000);
});
