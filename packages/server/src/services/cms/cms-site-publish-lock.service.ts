import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, sql } from 'drizzle-orm';
import { TaskCancelledError } from '../../lib/task-center';
import { db } from '../../db';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { cmsSites, cmsTemplates, type CmsSiteRow } from '../../db/schema';
import type { CmsPublishSubmitInput } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { getCmsEffectiveThemeDeployment } from './cms-site-inheritance.service';

const writeFenceStore = new AsyncLocalStorage<() => Promise<void>>();

export async function acquireCmsSitePublishLock(executor: DbExecutor, siteId: number): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-publish'), ${siteId})`);
}

/** Theme switch 与所有 template lifecycle 的第一把锁；统一顺序为 global → template row → site。 */
export async function acquireCmsGlobalThemeLifecycleLock(executor: DbExecutor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext('cms-global-theme-lifecycle'))`);
}

export async function lockCmsSiteForMutation(tx: DbTransaction, siteId: number): Promise<CmsSiteRow> {
  await acquireCmsSitePublishLock(tx, siteId);
  const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, siteId)).for('update').limit(1);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  return site;
}

export async function bumpCmsTemplateRefsRevision(tx: DbTransaction, siteId: number): Promise<number> {
  const [site] = await tx.update(cmsSites)
    .set({ templateRefsRevision: sql`${cmsSites.templateRefsRevision} + 1` })
    .where(eq(cmsSites.id, siteId))
    .returning({ revision: cmsSites.templateRefsRevision });
  if (!site) throw new Error(`站点 #${siteId} 不存在`);
  return site.revision;
}

export async function cmsSiteFencePayload(executor: DbExecutor, site: CmsSiteRow) {
  const { deployment } = await getCmsEffectiveThemeDeployment(site.id, executor);
  return {
    expectedThemeRevision: site.themeRevision,
    expectedTemplateRefsRevision: site.templateRefsRevision,
    expectedDeploymentId: deployment?.id ?? null,
  };
}

export async function assertCmsPublishFence(
  executor: DbExecutor,
  input: CmsPublishSubmitInput,
): Promise<void> {
  const [site] = await executor.select({
    themeRevision: cmsSites.themeRevision,
    templateRefsRevision: cmsSites.templateRefsRevision,
  }).from(cmsSites).where(eq(cmsSites.id, input.siteId)).limit(1);
  const stale = (reason: string): never => {
    throw new TaskCancelledError(`发布修订已过期：${reason}`, {
      stale: true,
      siteId: input.siteId,
      expectedThemeRevision: input.expectedThemeRevision ?? null,
      expectedTemplateRefsRevision: input.expectedTemplateRefsRevision ?? null,
    });
  };
  if (!site) stale('站点已删除');
  if (input.expectedThemeRevision != null && site.themeRevision !== input.expectedThemeRevision) {
    stale(`themeRevision 期望 ${input.expectedThemeRevision}，当前 ${site.themeRevision}`);
  }
  if (input.expectedTemplateRefsRevision != null && site.templateRefsRevision !== input.expectedTemplateRefsRevision) {
    stale(`templateRefsRevision 期望 ${input.expectedTemplateRefsRevision}，当前 ${site.templateRefsRevision}`);
  }
  if (input.expectedDeploymentId !== undefined) {
    const { deployment } = await getCmsEffectiveThemeDeployment(input.siteId, executor);
    if ((deployment?.id ?? null) !== input.expectedDeploymentId) {
      stale(`deployment 期望 ${input.expectedDeploymentId ?? 'builtin'}，当前 ${deployment?.id ?? 'builtin'}`);
    }
  }
  if (input.templateId && input.expectedTemplateLifecycleRevision != null) {
    const [template] = await executor.select({ revision: cmsTemplates.lifecycleRevision })
      .from(cmsTemplates).where(eq(cmsTemplates.id, input.templateId)).limit(1);
    if (!template || template.revision !== input.expectedTemplateLifecycleRevision) {
      stale(`template #${input.templateId} revision 期望 ${input.expectedTemplateLifecycleRevision}，当前 ${template?.revision ?? 'missing'}`);
    }
  }
}

export function withCmsStaticWriteFence<T>(assertCurrent: () => Promise<void>, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(writeFenceStore.run(assertCurrent, fn));
}

export async function assertCmsStaticWriteFence(): Promise<void> {
  await writeFenceStore.getStore()?.();
}

export async function withCmsSitePublishLock<T>(
  siteId: number,
  input: CmsPublishSubmitInput,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await acquireCmsSitePublishLock(tx, siteId);
    await assertCmsPublishFence(tx, input);
    return withCmsStaticWriteFence(() => assertCmsPublishFence(tx, input), () => fn(tx));
  });
}
