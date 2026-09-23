import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsDeploymentSchema, cmsReleaseContract, cmsReleaseSchema, type CreateCmsReleaseInput, type CmsRelease } from '@zenith/shared/cms';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db, withDbExecutor, withoutDbExecutor } from '../../db';
import { asyncTasks, cmsContents, cmsContentSuppressions, cmsContentWorkingCopies, cmsContentRevisions, cmsDeployments, cmsReleases, cmsSiteGenerations, cmsSites, type CmsReleaseRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { entityMapper } from '../../lib/entity-map';
import { listRows } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { enqueueAsyncTask, persistAsyncTask, registerTaskHandler } from '../../lib/task-center';
import { assertSiteAccess, ensureCmsSiteExists, invalidateSiteCache } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess, assertChannelAccess } from './cms-channels.service';
import { acquireCmsSitePublishLock } from './cms-site-publish-lock.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';
import { applyCmsRevisionProjection, loadCmsPublishableRevision, markCmsRevisionPublished, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { buildSiteStatic } from './cms-static.service';
import { withCmsGenerationContext } from './cms-generation-context';
import { cmsGenerationManifest, cmsGenerationSchemaName, collectCmsGenerationArtifacts, createCmsGenerationStorage, dropFailedCmsGenerationStorage, hashCmsDeploymentManifest, sealCmsGenerationStorage, verifyCmsGenerationArtifacts } from './cms-generation-storage.service';
import { reloadCmsSearchDict } from './cms-search.service';
import { enqueueCmsWebhookEvents, insertCmsContentWebhookOutbox } from './cms-webhook.service';
import { insertCmsCdnPurgeOutbox } from './cms-cdn.service';
import { isCmsRevisionAssetVisible } from './cms-asset-rights.service';
import { APP_TIME_ZONE, formatDateTime } from '../../lib/datetime';
import { formatCmsReleaseActivationTime, resolveCmsReleaseActivationTime } from './cms-release-time';

const mapRelease = entityMapper(cmsReleaseSchema, (row: CmsReleaseRow) => ({ activateAt: formatCmsReleaseActivationTime(row.activateAt, row.timeZone) }));
const mapDeployment = entityMapper(cmsDeploymentSchema);
const RELEASE_BUILD_TASK = 'cms-release-build';
let buildTail: Promise<void> = Promise.resolve();
async function acquireGenerationBuildSlot(): Promise<() => void> {
  const previous = buildTail;
  let release!: () => void;
  buildTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}

async function requireRelease(id: number): Promise<CmsReleaseRow> {
  const [row] = await db.select().from(cmsReleases).where(eq(cmsReleases.id, id)).limit(1);
  const release = requireRow(row, '发布单不存在');
  await assertSiteAccess(release.siteId);
  return release;
}
async function activeGeneration(siteId: number, tx: DbTransaction | typeof db = db): Promise<number | null> {
  const [row] = await tx.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, siteId)).limit(1);
  return row?.activeGenerationId ?? null;
}

export async function listCmsReleases(query: QueryOutputOf<typeof cmsReleaseContract.list>) {
  await assertSiteAccess(query.siteId);
  return listRows({ page: query.page, pageSize: query.pageSize, table: cmsReleases,
    where: buildWhere(eq(cmsReleases.siteId, query.siteId), query.status ? eq(cmsReleases.status, query.status) : undefined,
      keywordCondition(query.keyword, [cmsReleases.name], 'ilike'), ...dateRangeConditions(cmsReleases.createdAt, query.startTime, query.endTime)),
    orderBy: [desc(cmsReleases.id)], map: mapRelease });
}
export async function getCmsReleaseDetail(id: number) {
  const release = await requireRelease(id);
  const [deployment] = release.deploymentId
    ? await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, release.deploymentId)).limit(1) : [];
  const activeGenerationId = await activeGeneration(release.siteId);
  const blockingChecks: string[] = [];
  if (release.status !== 'active' && activeGenerationId !== release.baseGenerationId) blockingChecks.push('当前公开代次已变化，请创建基于最新代次的发布单');
  if (!deployment || !['ready', 'active', 'retired'].includes(deployment.status)) blockingChecks.push('候选部署尚未成功构建');
  if (release.error) blockingChecks.push(release.error);
  return { ...mapRelease(release), deployment: deployment ? mapDeployment(deployment) : null, activeGenerationId, blockingChecks };
}

export async function createCmsRelease(input: CreateCmsReleaseInput): Promise<CmsRelease> {
  const activateAt = resolveCmsReleaseActivationTime(input.activateAt, input.timeZone);
  await assertSiteAccess(input.siteId);
  await assertAllCmsSiteChannelsAccess(input.siteId);
  await ensureCmsSiteExists(input.siteId);
  const ids = [...new Set(input.revisionIds)];
  const withdrawals = [...new Set(input.withdrawContentIds)];
  const release = await db.transaction(async (tx) => {
    await acquireCmsSitePublishLock(tx, input.siteId);
    const items: CmsRelease['items'] = [];
    for (const id of ids) {
      const revision = await loadCmsPublishableRevision(tx, id);
      if (!await isCmsRevisionAssetVisible(revision.snapshot, tx)) throw new HTTPException(409, { message: '发布修订包含已撤权或授权过期的素材' });
      if (revision.siteId !== input.siteId) throw new HTTPException(400, { message: '发布单修订必须属于同一站点' });
      if (items.some((item) => item.contentId === revision.contentId)) throw new HTTPException(400, { message: '同一内容不能同时发布两个修订' });
      if (withdrawals.includes(revision.contentId)) throw new HTTPException(400, { message: '同一内容不能同时发布与撤下' });
      items.push({ contentId: revision.contentId, revisionId: revision.id, title: revision.payload.title, action: 'publish' });
    }
    if (withdrawals.length) {
      const rows = await tx.select().from(cmsContents).where(and(eq(cmsContents.siteId, input.siteId), inArray(cmsContents.id, withdrawals)));
      if (rows.length !== withdrawals.length) throw new HTTPException(404, { message: '撤下内容不存在或不属于本站' });
      items.push(...rows.map((row) => ({ contentId: row.id, revisionId: null, title: row.title, action: 'withdraw' as const })));
    }
    const [row] = await tx.insert(cmsReleases).values({
      siteId: input.siteId, name: input.name, items, baseGenerationId: await activeGeneration(input.siteId, tx),
      activateAt, timeZone: input.timeZone,
      autoActivate: input.autoActivate || Boolean(input.activateAt),
    }).returning();
    return row;
  });
  return mapRelease(release);
}

export async function buildCmsRelease(id: number): Promise<CmsRelease> {
  const release = await requireRelease(id);
  await assertAllCmsSiteChannelsAccess(release.siteId);
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(cmsReleases).where(eq(cmsReleases.id, id)).for('update').limit(1);
    if (!locked || !['draft', 'failed'].includes(locked.status)) throw new HTTPException(409, { message: '仅草稿或构建失败的发布单可以构建' });
    if (await activeGeneration(locked.siteId, tx) !== locked.baseGenerationId) throw new HTTPException(409, { message: '发布基代已变化，请新建发布单' });
    const [deployment] = await tx.insert(cmsDeployments).values({ siteId: locked.siteId, releaseId: id }).returning();
    const [updated] = await tx.update(cmsReleases).set({ status: 'building', deploymentId: deployment.id, error: null }).where(eq(cmsReleases.id, id)).returning();
    const task = await persistAsyncTask(tx, { taskType: RELEASE_BUILD_TASK, title: `CMS 发布单：${locked.name}`, tenantId: null, payload: { siteId: locked.siteId, releaseId: id, deploymentId: deployment.id }, idempotencyKey: `cms-release:${id}:deployment:${deployment.id}` });
    return { release: updated, task };
  });
  await enqueueAsyncTask(result.task.id).catch(() => undefined); // Durable pending recovery retries queue delivery.
  return mapRelease(result.release);
}

/** The editor submits a revision. Public rows are untouched until the candidate succeeds. */
export async function createCmsContentRelease(input: { contentId: number; revisionId: number; expectedVersion?: number }): Promise<CmsRelease> {
  const revision = await loadCmsPublishableRevision(db, input.revisionId);
  if (revision.contentId !== input.contentId) throw new HTTPException(400, { message: '修订不属于指定内容' });
  const working = await requireCmsWorkingCopy(db, input.contentId);
  if (input.expectedVersion != null && working.version !== input.expectedVersion) throw new HTTPException(409, { message: '工作稿版本已变化，请刷新后重试' });
  const [pending] = await db.select().from(cmsReleases).where(and(eq(cmsReleases.siteId, revision.siteId),
    inArray(cmsReleases.status, ['draft', 'building', 'ready', 'scheduled']),
    sql`${cmsReleases.items} @> ${JSON.stringify([{ contentId: input.contentId, revisionId: input.revisionId }])}::jsonb`,
  )).orderBy(desc(cmsReleases.id)).limit(1);
  if (pending) return pending.status === 'draft' ? buildCmsRelease(pending.id) : mapRelease(pending);
  const created = await createCmsRelease({ siteId: revision.siteId, name: `发布：${revision.payload.title}`, revisionIds: [revision.id], withdrawContentIds: [], autoActivate: true,
    activateAt: revision.payload.scheduledAt ? formatDateTime(revision.payload.scheduledAt) : null, timeZone: APP_TIME_ZONE });
  return buildCmsRelease(created.id);
}

export async function createCmsConfigurationRelease(siteId: number, sourceTaskId: number, reason?: string): Promise<CmsRelease> {
  const name = `配置发布 #${sourceTaskId}：${reason ?? '站点公开配置更新'}`.slice(0, 200);
  const [existing] = await db.select().from(cmsReleases).where(and(eq(cmsReleases.siteId, siteId), eq(cmsReleases.name, name))).orderBy(desc(cmsReleases.id)).limit(1);
  if (existing) return existing.status === 'draft' ? buildCmsRelease(existing.id) : mapRelease(existing);
  const release = await createCmsRelease({ siteId, name, revisionIds: [], withdrawContentIds: [], autoActivate: true, timeZone: 'Asia/Shanghai' });
  return buildCmsRelease(release.id);
}

/** Restore the fixed public projection; live counters and identity/audit ownership are preserved. */
async function restoreProjection(tx: DbTransaction, siteId: number, generationId: number): Promise<void> {
  const schema = cmsGenerationSchemaName(generationId);
  const columns = await tx.execute<{ name: string }>(sql`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='cms_contents' AND is_generated='NEVER' ORDER BY ordinal_position`);
  const kept = new Set(['id', 'site_id', 'created_at', 'created_by', 'updated_by', 'updated_at', 'dept_id', 'view_count', 'like_count', 'favorite_count']);
  const names = columns.map((row) => row.name).filter((name) => !kept.has(name));
  if (names.some((name) => !/^[a-z][a-z0-9_]*$/.test(name))) throw new Error('Invalid content column');
  const assignments = names.map((name) => `"${name}" = snapshot."${name}"`).join(',');
  await tx.execute(sql.raw(`UPDATE public.cms_contents target SET ${assignments},updated_at=now() FROM "${schema}".cms_content_projection snapshot WHERE target.id=snapshot.id AND target.site_id=${siteId}`));
  await tx.execute(sql`UPDATE public.cms_contents SET status='offline' WHERE site_id=${siteId} AND status='published' AND id NOT IN (${sql.raw(`SELECT id FROM "${schema}".cms_content_projection` )})`);
  for (const table of ['cms_content_tags', 'cms_content_channels', 'cms_content_relations']) {
    await tx.execute(sql.raw(`DELETE FROM public.${table} WHERE content_id IN (SELECT id FROM public.cms_contents WHERE site_id=${siteId})`));
    await tx.execute(sql.raw(`INSERT INTO public.${table} SELECT * FROM "${schema}".${table}`));
  }
}

export async function activateCmsRelease(id: number, expectedGenerationId: number | null, rollback = false): Promise<CmsRelease> {
  const release = await requireRelease(id);
  await assertAllCmsSiteChannelsAccess(release.siteId);
  const [preparedDeployment] = release.deploymentId ? await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, release.deploymentId)).limit(1) : [];
  if (!preparedDeployment?.snapshot) throw new HTTPException(409, { message: '候选部署尚未完成' });
  if (hashCmsDeploymentManifest(preparedDeployment.snapshot) !== preparedDeployment.manifestHash) throw new HTTPException(409, { message: '部署清单完整性校验失败' });
  await verifyCmsGenerationArtifacts(preparedDeployment.id, preparedDeployment.snapshot);
  const result = await db.transaction(async (tx) => {
    await acquireCmsSitePublishLock(tx, release.siteId);
    const [locked] = await tx.select().from(cmsReleases).where(eq(cmsReleases.id, id)).for('update').limit(1);
    if (!locked?.deploymentId) throw new HTTPException(409, { message: '发布单尚未生成候选部署' });
    const current = await activeGeneration(locked.siteId, tx);
    if (current === locked.deploymentId && locked.status === 'active') return { release: locked, webhooks: [], cdnTaskId: null };
    if (current !== expectedGenerationId || (!rollback && current !== locked.baseGenerationId)) throw new HTTPException(409, { message: '公开代次已变化，本次激活没有覆盖其他发布' });
    const allowed = rollback ? ['active', 'superseded'] : ['ready', 'scheduled'];
    if (!allowed.includes(locked.status)) throw new HTTPException(409, { message: '发布单状态不允许激活' });
    const [deployment] = await tx.select().from(cmsDeployments).where(eq(cmsDeployments.id, locked.deploymentId)).for('update').limit(1);
    if (!deployment?.snapshot || !['ready', 'retired', 'active'].includes(deployment.status)) throw new HTTPException(409, { message: '候选部署未完成或已损坏' });
    const now = new Date();
    if (!rollback) for (const item of locked.items) {
      if (!item.revisionId) continue;
      const revision = await loadCmsPublishableRevision(tx, item.revisionId);
      if (!await isCmsRevisionAssetVisible(revision.snapshot, tx)) throw new HTTPException(409, { message: '修订素材授权已变化，拒绝激活' });
      if (!deployment.snapshot.revisions.some((entry) => entry.revisionId === revision.id && entry.hash === revision.hash)) throw new HTTPException(409, { message: '发布修订与构建快照不一致' });
      await applyCmsRevisionProjection(tx, revision, { publishedAt: now, generationId: deployment.id });
      await markCmsRevisionPublished(tx, revision.contentId, revision.id);
    }
    await restoreProjection(tx, locked.siteId, deployment.id);
    if (rollback) for (const entry of deployment.snapshot.revisions) await markCmsRevisionPublished(tx, entry.contentId, entry.revisionId);
    if (current) {
      await tx.update(cmsDeployments).set({ status: 'retired' }).where(eq(cmsDeployments.id, current));
      await tx.update(cmsReleases).set({ status: 'superseded' }).where(and(eq(cmsReleases.siteId, locked.siteId), eq(cmsReleases.status, 'active')));
    }
    await tx.insert(cmsSiteGenerations).values({ siteId: locked.siteId, activeGenerationId: deployment.id, revision: 1 }).onConflictDoUpdate({ target: cmsSiteGenerations.siteId, set: { activeGenerationId: deployment.id, revision: sql`${cmsSiteGenerations.revision}+1`, updatedAt: now } });
    await tx.update(cmsDeployments).set({ status: 'active', activatedAt: now, error: null }).where(eq(cmsDeployments.id, deployment.id));
    const [updated] = await tx.update(cmsReleases).set({ status: 'active', error: null }).where(eq(cmsReleases.id, id)).returning();
    const webhooks = [];
    for (const item of locked.items) {
      const [content] = await tx.select().from(cmsContents).where(eq(cmsContents.id, item.contentId)).limit(1);
      if (content) webhooks.push(await insertCmsContentWebhookOutbox(tx, content.status === 'published' ? 'cms.content.published' : 'cms.content.offline', content));
    }
    const cdnTask = await insertCmsCdnPurgeOutbox(tx, locked.siteId, `activate:${deployment.id}:${now.getTime()}`);
    return { release: updated, webhooks, cdnTaskId: cdnTask.id };
  });
  invalidateSiteCache();
  await invalidateCmsSiteCaches(release.siteId);
  await enqueueCmsWebhookEvents(result.webhooks);
  if (result.cdnTaskId) await enqueueAsyncTask(result.cdnTaskId).catch(() => undefined);
  return mapRelease(result.release);
}

export async function cancelCmsRelease(id: number): Promise<CmsRelease> {
  const release = await requireRelease(id);
  const [row] = await db.update(cmsReleases).set({ status: 'cancelled' }).where(and(eq(cmsReleases.id, id), inArray(cmsReleases.status, ['draft', 'building', 'ready', 'scheduled', 'failed']))).returning();
  if (!row) throw new HTTPException(409, { message: '已生效的发布单不能取消，请使用回滚或撤下' });
  return mapRelease({ ...row, siteId: release.siteId });
}

export async function suppressCmsContent(contentId: number, reason: string, suppressed: boolean): Promise<void> {
  const [content] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  const row = requireRow(content, '内容不存在');
  await assertSiteAccess(row.siteId); await assertChannelAccess(row.channelId);
  const task = await db.transaction(async (tx) => {
    await acquireCmsSitePublishLock(tx, row.siteId);
    if (suppressed) await tx.insert(cmsContentSuppressions).values({ contentId, siteId: row.siteId, reason }).onConflictDoUpdate({ target: cmsContentSuppressions.contentId, set: { reason, updatedAt: new Date() } });
    else await tx.delete(cmsContentSuppressions).where(eq(cmsContentSuppressions.contentId, contentId));
    // A visibility-only change still advances incremental delivery cursors.
    await tx.update(cmsContents).set({ version: sql`${cmsContents.version}` }).where(eq(cmsContents.id, contentId));
    return insertCmsCdnPurgeOutbox(tx, row.siteId, `visibility:${contentId}:${Date.now()}`);
  });
  await invalidateCmsSiteCaches(row.siteId);
  await enqueueAsyncTask(task.id).catch(() => undefined);
}

export async function activateScheduledCmsReleases(): Promise<number> {
  // A process can die before a handler's catch executes. Reconcile only after
  // task-center recovery has made the durable task terminal.
  const abandoned = await db.select().from(cmsReleases).where(and(eq(cmsReleases.status, 'building'), sql`NOT EXISTS (
    SELECT 1 FROM ${asyncTasks} WHERE ${asyncTasks.taskType}=${RELEASE_BUILD_TASK}
    AND ${asyncTasks.payload}->>'releaseId'=${cmsReleases.id}::text
    AND ${asyncTasks.status} IN ('pending','running')
  )`)).limit(100);
  for (const row of abandoned) {
    await db.update(cmsReleases).set({ status: 'failed', error: '构建任务已结束但尚未完成发布准备，可重新构建' }).where(and(eq(cmsReleases.id, row.id), eq(cmsReleases.status, 'building')));
  }
  const due = await db.select().from(cmsReleases).where(and(eq(cmsReleases.status, 'scheduled'), isNotNull(cmsReleases.activateAt), lte(cmsReleases.activateAt, new Date()))).orderBy(asc(cmsReleases.activateAt)).limit(100);
  let activated = 0;
  for (const row of due) {
    try { await activateCmsRelease(row.id, row.baseGenerationId); activated++; }
    catch (error) { await db.update(cmsReleases).set({ status: 'failed', error: error instanceof Error ? error.message : String(error) }).where(and(eq(cmsReleases.id, row.id), eq(cmsReleases.status, 'scheduled'))); }
  }
  return activated;
}

export function registerCmsReleaseTaskHandler(): void {
  registerTaskHandler({ taskType: RELEASE_BUILD_TASK, title: 'CMS 发布单构建', module: 'CMS内容管理', allowConcurrent: true, maxAttempts: 1,
    async run(ctx) {
      const releaseId = Number(ctx.payload.releaseId); const deploymentId = Number(ctx.payload.deploymentId);
      const release = await requireRelease(releaseId);
      if (release.deploymentId !== deploymentId || release.status !== 'building') return { skipped: true };
      await assertAllCmsSiteChannelsAccess(release.siteId);
      const releaseSlot = await acquireGenerationBuildSlot();
      try {
        const [existingDeployment] = await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, deploymentId)).limit(1);
        if (existingDeployment?.status !== 'ready') await db.transaction(async (tx) => {
          await createCmsGenerationStorage(tx, release.siteId, deploymentId);
          const revisions = [];
          for (const item of release.items) if (item.revisionId) revisions.push(await loadCmsPublishableRevision(tx, item.revisionId));
          const existingRevisions = await tx.select({ contentId: cmsContentWorkingCopies.contentId, revisionId: cmsContentRevisions.id, hash: cmsContentRevisions.hash })
            .from(cmsContentWorkingCopies).innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
            .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.publishedRevisionId)).where(eq(cmsContents.siteId, release.siteId));
          const revisionMap = new Map(existingRevisions.map((entry) => [entry.contentId, entry]));
          for (const revision of revisions) revisionMap.set(revision.contentId, { contentId: revision.contentId, revisionId: revision.id, hash: revision.hash });
          await tx.execute(sql`select set_config('search_path', ${`${cmsGenerationSchemaName(deploymentId)},public`}, true)`);
          await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: release.siteId, generationId: deploymentId, candidate: true }, async () => {
            await reloadCmsSearchDict(release.siteId);
            for (const revision of revisions) await applyCmsRevisionProjection(tx, revision, { publishedAt: release.activateAt ?? new Date(), generationId: deploymentId, candidate: true });
            const withdrawIds = release.items.filter((item) => item.action === 'withdraw').map((item) => item.contentId);
            if (withdrawIds.length) await tx.update(cmsContents).set({ status: 'offline' }).where(inArray(cmsContents.id, withdrawIds));
            const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, release.siteId)).limit(1);
            await tx.update(cmsSites).set({ staticMode: 'static' }).where(eq(cmsSites.id, release.siteId));
            await buildSiteStatic(release.siteId, async (progress) => {
              const result = await withoutDbExecutor(() => ctx.progress({ processed: progress.processed, total: progress.total, note: progress.note }));
              const [currentRelease] = await withoutDbExecutor(() => db.select({ status: cmsReleases.status }).from(cmsReleases).where(eq(cmsReleases.id, releaseId)).limit(1));
              if (currentRelease?.status === 'cancelled') throw new Error('发布单已取消');
              if (result.cancelRequested) throw new Error('发布构建已取消');
              return false;
            });
            await tx.update(cmsSites).set({ staticMode: site.staticMode }).where(eq(cmsSites.id, release.siteId));
            const manifest = await cmsGenerationManifest(tx, deploymentId, [...revisionMap.values()]);
            manifest.snapshot.siteCode = site.code;
            manifest.snapshot.sitePublicRevision = site.publicRevision;
            manifest.snapshot.artifacts = await collectCmsGenerationArtifacts(site.code, deploymentId);
            manifest.hash = hashCmsDeploymentManifest(manifest.snapshot);
            await sealCmsGenerationStorage(tx, deploymentId, manifest.snapshot.revisions);
            await tx.update(cmsDeployments).set({ status: 'ready', snapshot: manifest.snapshot, manifestHash: manifest.hash, artifactCount: manifest.snapshot.artifacts.length }).where(eq(cmsDeployments.id, deploymentId));
          }));
        }, { isolationLevel: 'repeatable read' });
        const status = release.activateAt && release.activateAt > new Date() ? 'scheduled' : 'ready';
        const [ready] = await db.update(cmsReleases).set({ status, error: null }).where(and(eq(cmsReleases.id, releaseId), eq(cmsReleases.status, 'building'), eq(cmsReleases.deploymentId, deploymentId))).returning();
        if (ready?.autoActivate && status === 'ready') await activateCmsRelease(releaseId, release.baseGenerationId);
        return { releaseId, deploymentId, status: ready?.status ?? 'cancelled' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.update(cmsDeployments).set({ status: 'failed', error: message }).where(and(eq(cmsDeployments.id, deploymentId), inArray(cmsDeployments.status, ['building', 'ready'])));
        await db.update(cmsReleases).set({ status: 'failed', error: message }).where(and(eq(cmsReleases.id, releaseId), eq(cmsReleases.deploymentId, deploymentId), inArray(cmsReleases.status, ['building', 'ready', 'scheduled'])));
        await dropFailedCmsGenerationStorage(deploymentId);
        throw error;
      } finally {
        releaseSlot();
      }
    },
  });
}
