import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsDeploymentSchema, cmsReleaseActivationSchema, cmsReleaseContract, cmsReleaseSchema, type CreateCmsReleaseInput, type CmsRelease } from '@zenith/shared/cms';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db, withDbExecutor, withoutDbExecutor } from '../../db';
import { asyncTasks, cmsChannels, cmsContents, cmsContentSuppressions, cmsContentWorkingCopies, cmsContentRevisions, cmsDeployments, cmsReleases, cmsReleaseActivations, cmsSiteGenerations, cmsSites, type CmsReleaseRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { requireRow } from '../../lib/db-assert';
import { entityMapper } from '../../lib/entity-map';
import { currentUserOrNull, hasPermission } from '../../lib/context';
import { listRows } from '../../lib/list-query';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { enqueueAsyncTask, persistAsyncTask, registerTaskHandler } from '../../lib/task-center';
import { assertSiteAccess, ensureCmsSiteExists, invalidateSiteCache } from './cms-sites.service';
import { acquireCmsSitePublishLock } from './cms-site-publish-lock.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';
import { applyCmsRevisionProjection, loadCmsPublishableRevision, markCmsRevisionPublished, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { buildSiteStatic } from './cms-static.service';
import { withCmsGenerationContext } from './cms-generation-context';
import { cmsGenerationManifest, cmsGenerationSchemaName, collectCmsGenerationArtifacts, createCmsGenerationStorage, dropFailedCmsGenerationStorage, hashCmsDeploymentManifest, sealCmsGenerationStorage, verifyCmsGenerationArtifacts, withCmsGenerationTransaction } from './cms-generation-storage.service';
import { ensureSiteThemeCssAsset, renderSitePath } from './cms-render.service';
import { stripCmsPreviewScripts } from './cms-preview';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { rebuildSearchIndex, reloadCmsSearchDict } from './cms-search.service';
import { enqueueCmsWebhookEvents, insertCmsContentWebhookOutbox } from './cms-webhook.service';
import { insertCmsCdnPurgeOutbox } from './cms-cdn.service';
import { insertCmsSubscriptionNotificationOutbox, enqueueCmsSubscriptionNotification } from './cms-stage4-tasks';
import { logContentOp } from './cms-content-op-logs.service';
import { requireCmsContentAccess } from './cms-content-access.service';
import { syncCmsResourceRefs } from './cms-resource-refs.service';
import { captureCmsConfiguration, type CmsCapturedConfiguration } from './cms-configuration-snapshot.service';
import { assertCmsReleaseSelectionAccess, cmsReleaseScope } from './cms-release-access.service';
import { assertCmsReleaseDependencies } from './cms-release-preflight.service';
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
  const scope = await cmsReleaseScope(release.siteId);
  const [permitted] = await db.select({ id: cmsReleases.id }).from(cmsReleases).where(and(eq(cmsReleases.id, id), scope)).limit(1);
  if (!permitted) throw new HTTPException(404, { message: '发布单不存在或无权访问其中对象' });
  return release;
}
async function activeGeneration(siteId: number, tx: DbTransaction | typeof db = db): Promise<number | null> {
  const [row] = await tx.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, siteId)).limit(1);
  return row?.activeGenerationId ?? null;
}

export async function listCmsReleases(query: QueryOutputOf<typeof cmsReleaseContract.list>) {
  const scope = await cmsReleaseScope(query.siteId);
  return listRows({ page: query.page, pageSize: query.pageSize, table: cmsReleases,
    where: buildWhere(eq(cmsReleases.siteId, query.siteId), scope, query.status ? eq(cmsReleases.status, query.status) : undefined,
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
  const activations = await db.select().from(cmsReleaseActivations).where(eq(cmsReleaseActivations.releaseId, id)).orderBy(desc(cmsReleaseActivations.id)).limit(100);
  return { ...mapRelease(release), deployment: deployment ? mapDeployment(deployment) : null, activeGenerationId, blockingChecks, activations: activations.map(entityMapper(cmsReleaseActivationSchema)) };
}
export async function previewCmsRelease(id: number, path: string) {
  const release = await requireRelease(id);
  if (!release.deploymentId || !['ready', 'scheduled', 'active', 'superseded'].includes(release.status)) throw new HTTPException(409, { message: '请先成功构建候选部署再预览' });
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.split('/').some((segment) => segment === '..' || segment === '.')) throw new HTTPException(400, { message: '预览仅支持当前站点路径' });
  return withCmsGenerationTransaction(release.siteId, release.deploymentId, true, async () => {
    const site = await resolveEffectiveCmsSiteRow(release.siteId);
    const rendered = await renderSitePath(site, '', path.replace(/^\/+/, ''));
    if (rendered.status === 302) throw new HTTPException(400, { message: '外链目标请直接打开，不能作为部署页面预览' });
    const theme = await ensureSiteThemeCssAsset(site);
    const html = stripCmsPreviewScripts(rendered.html).replace(/<link\b[^>]*href=["'][^"']*_assets\/theme\.[^"']+\.css["'][^>]*>/gi, `<style>${theme.css.replace(/<\/style/gi, '<\\/style')}</style>`);
    return { html, status: rendered.status, path, generationId: release.deploymentId! };
  });
}

export async function createCmsRelease(input: CreateCmsReleaseInput, captured?: CmsCapturedConfiguration): Promise<CmsRelease> {
  const activateAt = resolveCmsReleaseActivationTime(input.activateAt, input.timeZone);
  if (!captured && !input.revisionIds.length && !input.withdrawContentIds.length && !input.pageIds.length && !input.widgetIds.length && !input.includeSiteConfiguration) throw new HTTPException(400, { message: '请至少选择一个内容修订、页面、部件或站点配置' });
  const configurationRequested = captured ? captured.items.length > 0 : Boolean(input.includeSiteConfiguration || input.pageIds.length || input.widgetIds.length);
  if ((input.autoActivate || input.activateAt) && !await hasPermission('cms:publish:manage')
    && (configurationRequested || !await hasPermission('cms:content:publish'))) throw new HTTPException(403, { message: '缺少所选发布单的自动激活权限' });
  await assertSiteAccess(input.siteId);
  await assertCmsReleaseSelectionAccess(input.siteId, input.revisionIds, input.withdrawContentIds,
    captured ? (captured.items.length > 0 || (!input.revisionIds.length && !input.withdrawContentIds.length)) : Boolean(input.includeSiteConfiguration || input.pageIds.length || input.widgetIds.length));
  await ensureCmsSiteExists(input.siteId);
  const ids = [...new Set(input.revisionIds)];
  const withdrawals = [...new Set(input.withdrawContentIds)];
  const release = await db.transaction(async (tx) => {
    await acquireCmsSitePublishLock(tx, input.siteId);
    const configuration = captured ?? await captureCmsConfiguration(tx, input.siteId, input);
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
    configuration.snapshot.publicContentGuards = items.length ? await tx.select({ id: cmsContents.id, version: cmsContents.version, status: cmsContents.status }).from(cmsContents).where(inArray(cmsContents.id, items.map((item) => item.contentId))) : [];
    const [row] = await tx.insert(cmsReleases).values({
      siteId: input.siteId, name: input.name, items, configurationItems: configuration.items, configurationSnapshot: configuration.snapshot, baseGenerationId: captured ? captured.baseGenerationId : await activeGeneration(input.siteId, tx),
      activateAt, timeZone: input.timeZone,
      autoActivate: input.autoActivate || Boolean(input.activateAt),
    }).returning();
    await syncCmsResourceRefs(tx, 'release', row.id, input.siteId, row);
    return row;
  });
  return mapRelease(release);
}

export async function buildCmsRelease(id: number): Promise<CmsRelease> {
  await requireRelease(id);
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
  await requireCmsContentAccess(input.contentId);
  const revision = await loadCmsPublishableRevision(db, input.revisionId);
  if (revision.contentId !== input.contentId) throw new HTTPException(400, { message: '修订不属于指定内容' });
  const working = await requireCmsWorkingCopy(db, input.contentId);
  if (input.expectedVersion != null && working.version !== input.expectedVersion) throw new HTTPException(409, { message: '工作稿版本已变化，请刷新后重试' });
  const [pending] = await db.select().from(cmsReleases).where(and(eq(cmsReleases.siteId, revision.siteId),
    await cmsReleaseScope(revision.siteId),
    inArray(cmsReleases.status, ['draft', 'building', 'ready', 'scheduled']),
    sql`${cmsReleases.items} @> ${JSON.stringify([{ contentId: input.contentId, revisionId: input.revisionId }])}::jsonb`,
  )).orderBy(desc(cmsReleases.id)).limit(1);
  if (pending) return pending.status === 'draft' ? buildCmsRelease(pending.id) : mapRelease(pending);
  const created = await createCmsRelease({ siteId: revision.siteId, name: `发布：${revision.payload.title}`, revisionIds: [revision.id], withdrawContentIds: [], autoActivate: true,
    pageIds: [], widgetIds: [], includeSiteConfiguration: false,
    activateAt: revision.payload.scheduledAt ? formatDateTime(revision.payload.scheduledAt) : null, timeZone: APP_TIME_ZONE });
  return buildCmsRelease(created.id);
}

export async function createCmsConfigurationRelease(siteId: number, sourceTaskId: number, reason: string | undefined, captured: CmsCapturedConfiguration): Promise<CmsRelease> {
  const name = `配置发布 #${sourceTaskId}：${reason ?? '站点公开配置更新'}`.slice(0, 200);
  const [existing] = await db.select().from(cmsReleases).where(and(eq(cmsReleases.siteId, siteId), eq(cmsReleases.name, name))).orderBy(desc(cmsReleases.id)).limit(1);
  if (existing) { await requireRelease(existing.id); return existing.status === 'draft' ? buildCmsRelease(existing.id) : mapRelease(existing); }
  const release = await createCmsRelease({ siteId, name, revisionIds: [], withdrawContentIds: [], pageIds: [], widgetIds: [], includeSiteConfiguration: true, autoActivate: false, timeZone: APP_TIME_ZONE }, captured);
  return buildCmsRelease(release.id);
}

/** Restore the fixed public projection; live counters and identity/audit ownership are preserved. */
async function restoreProjection(tx: DbTransaction, siteId: number, generationId: number, previousGenerationId: number | null, explicitlyPublishedIds: number[]): Promise<void> {
  const schema = cmsGenerationSchemaName(generationId);
  const columns = await tx.execute<{ name: string }>(sql`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='cms_contents' AND is_generated='NEVER' ORDER BY ordinal_position`);
  const kept = new Set(['id', 'site_id', 'created_at', 'created_by', 'updated_by', 'updated_at', 'dept_id', 'view_count', 'like_count', 'favorite_count', 'version', 'member_id', 'locked_at', 'locked_by', 'lock_reason', 'deleted_at', 'archived_at', 'mapping_source_id', 'distribution_rule_id', 'distribution_source_id', 'distribution_source_version']);
  const names = columns.map((row) => row.name).filter((name) => !kept.has(name));
  if (names.some((name) => !/^[a-z][a-z0-9_]*$/.test(name))) throw new Error('Invalid content column');
  const runtimeKeys = [...kept].map((name) => `'${name}'`).join(',');
  const conflictingLocks = await tx.execute<{ id: number }>(sql.raw(`SELECT target.id FROM public.cms_contents target JOIN "${schema}".cms_content_projection snapshot ON snapshot.id=target.id WHERE target.site_id=${siteId} AND target.locked_at IS NOT NULL AND (to_jsonb(target)-ARRAY[${runtimeKeys}]::text[]) IS DISTINCT FROM (to_jsonb(snapshot)-ARRAY[${runtimeKeys}]::text[]) LIMIT 1`));
  if (conflictingLocks.length) throw new HTTPException(409, { message: `内容 #${conflictingLocks[0].id} 已合规锁定，本次部署不能改变其公开内容` });
  const notExplicitlyPublished = explicitlyPublishedIds.length ? `target.id NOT IN (${explicitlyPublishedIds.join(',')})` : 'true';
  const priorOffline = previousGenerationId ? `EXISTS (SELECT 1 FROM "${cmsGenerationSchemaName(previousGenerationId)}".cms_content_projection prior WHERE prior.id=target.id AND prior.status='offline')` : 'false';
  const assignments = names.map((name) => name === 'status'
    ? `status=CASE WHEN target.status='offline' AND snapshot.status='published' AND ${notExplicitlyPublished} AND NOT (${priorOffline}) THEN target.status ELSE snapshot.status END`
    : `"${name}" = snapshot."${name}"`).join(',');
  await tx.execute(sql.raw(`UPDATE public.cms_contents target SET ${assignments},updated_at=now() FROM "${schema}".cms_content_projection snapshot WHERE target.id=snapshot.id AND target.site_id=${siteId} AND target.locked_at IS NULL AND target.deleted_at IS NULL AND target.archived_at IS NULL`));
  await tx.execute(sql`UPDATE public.cms_contents SET status='offline' WHERE site_id=${siteId} AND status='published' AND id NOT IN (${sql.raw(`SELECT id FROM "${schema}".cms_content_projection` )})`);
  for (const table of ['cms_content_tags', 'cms_content_channels', 'cms_content_relations']) {
    await tx.execute(sql.raw(`DELETE FROM public.${table} WHERE content_id IN (SELECT id FROM public.cms_contents WHERE site_id=${siteId} AND locked_at IS NULL AND deleted_at IS NULL AND archived_at IS NULL)`));
    await tx.execute(sql.raw(`INSERT INTO public.${table} SELECT relation.* FROM "${schema}".${table} relation JOIN public.cms_contents owner ON owner.id=relation.content_id WHERE owner.locked_at IS NULL AND owner.deleted_at IS NULL AND owner.archived_at IS NULL`));
  }
}

export async function activateCmsRelease(id: number, expectedGenerationId: number | null, rollback = false): Promise<CmsRelease> {
  const release = await requireRelease(id);
  if (!await hasPermission('cms:publish:manage') && (rollback || release.configurationItems.length > 0 || !await hasPermission('cms:content:publish'))) throw new HTTPException(403, { message: '发布单激活权限已失效' });
  const [preparedDeployment] = release.deploymentId ? await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, release.deploymentId)).limit(1) : [];
  if (!preparedDeployment?.snapshot) throw new HTTPException(409, { message: '候选部署尚未完成' });
  if (rollback) {
    const currentId = await activeGeneration(release.siteId);
    const [currentDeployment] = currentId ? await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, currentId)).limit(1) : [];
    await assertCmsReleaseSelectionAccess(release.siteId,
      [...new Set([...preparedDeployment.snapshot.revisions, ...(currentDeployment?.snapshot?.revisions ?? [])].map((entry) => entry.revisionId))], [], true);
  }
  if (hashCmsDeploymentManifest(preparedDeployment.snapshot) !== preparedDeployment.manifestHash) throw new HTTPException(409, { message: '部署清单完整性校验失败' });
  await verifyCmsGenerationArtifacts(preparedDeployment.id, preparedDeployment.snapshot);
  const result = await db.transaction(async (tx) => {
    await acquireCmsSitePublishLock(tx, release.siteId);
    const [locked] = await tx.select().from(cmsReleases).where(eq(cmsReleases.id, id)).for('update').limit(1);
    if (!locked?.deploymentId) throw new HTTPException(409, { message: '发布单尚未生成候选部署' });
    const current = await activeGeneration(locked.siteId, tx);
    if (current === locked.deploymentId && locked.status === 'active') return { release: locked, webhooks: [], notifications: [], effects: [], cdnTaskId: null };
    if (current !== expectedGenerationId || (!rollback && current !== locked.baseGenerationId)) throw new HTTPException(409, { message: '公开代次已变化，本次激活没有覆盖其他发布' });
    const allowed = rollback ? ['active', 'superseded'] : ['ready', 'scheduled'];
    if (!allowed.includes(locked.status)) throw new HTTPException(409, { message: '发布单状态不允许激活' });
    const [deployment] = await tx.select().from(cmsDeployments).where(eq(cmsDeployments.id, locked.deploymentId)).for('update').limit(1);
    if (!deployment?.snapshot || !['ready', 'retired', 'active'].includes(deployment.status)) throw new HTTPException(409, { message: '候选部署未完成或已损坏' });
    const now = new Date();
    if (!await isCmsRevisionAssetVisible(locked.configurationSnapshot, tx)) throw new HTTPException(409, { message: '候选配置素材已撤权或过期，拒绝激活' });
    const rollbackAffected = rollback && current ? await tx.execute<{ id: number }>(sql.raw(`
      SELECT coalesce(next.id,previous.id) AS id FROM "${cmsGenerationSchemaName(deployment.id)}".cms_content_projection next
      FULL JOIN "${cmsGenerationSchemaName(current)}".cms_content_projection previous ON previous.id=next.id
      WHERE (next.status='published' OR previous.status='published') AND
      (next.status IS DISTINCT FROM previous.status OR next.body IS DISTINCT FROM previous.body OR next.title IS DISTINCT FROM previous.title
       OR next.extend IS DISTINCT FROM previous.extend OR next.channel_id IS DISTINCT FROM previous.channel_id
       OR next.slug IS DISTINCT FROM previous.slug OR next.media_data IS DISTINCT FROM previous.media_data
       OR next.attachments IS DISTINCT FROM previous.attachments OR next.cover_image IS DISTINCT FROM previous.cover_image)
    `)) : [];
    const currentDeployment = current ? (await tx.select().from(cmsDeployments).where(eq(cmsDeployments.id, current)).limit(1))[0] : null;
    const oldRevisions = new Map(currentDeployment?.snapshot?.revisions.map((entry) => [entry.contentId, entry.revisionId]) ?? []);
    const nextRevisions = new Map(deployment.snapshot.revisions.map((entry) => [entry.contentId, entry.revisionId]));
    const affectedIds = rollback ? [...new Set([...rollbackAffected.map((row) => row.id),
      ...[...new Set([...oldRevisions.keys(), ...nextRevisions.keys()])].filter((contentId) => oldRevisions.get(contentId) !== nextRevisions.get(contentId)),
    ])] : locked.items.map((item) => item.contentId);
    if (rollback) await tx.select({ id: cmsContentWorkingCopies.contentId }).from(cmsContentWorkingCopies)
      .where(sql`${cmsContentWorkingCopies.contentId} IN (SELECT ${cmsContents.id} FROM ${cmsContents} WHERE ${cmsContents.siteId}=${locked.siteId})`)
      .orderBy(asc(cmsContentWorkingCopies.contentId)).for('update');
    if (!rollback) for (const item of [...locked.items].sort((left, right) => left.contentId-right.contentId)) {
      await requireCmsWorkingCopy(tx, item.contentId, true);
      const [identity] = await tx.select().from(cmsContents).where(eq(cmsContents.id, item.contentId)).for('update').limit(1);
      const guard = locked.configurationSnapshot.publicContentGuards?.find((entry) => entry.id === item.contentId);
      if (!identity || !guard || identity.version !== guard.version || identity.status !== guard.status || identity.lockedAt || identity.deletedAt || identity.archivedAt) throw new HTTPException(409, { message: '发布单创建后内容公开状态或合规状态已变化，请重新创建发布单' });
    }
    if (!rollback) for (const item of locked.items) {
      if (!item.revisionId) continue;
      const revision = await loadCmsPublishableRevision(tx, item.revisionId);
      if (!await isCmsRevisionAssetVisible(revision.snapshot, tx)) throw new HTTPException(409, { message: '修订素材授权已变化，拒绝激活' });
      if (!deployment.snapshot.revisions.some((entry) => entry.revisionId === revision.id && entry.hash === revision.hash)) throw new HTTPException(409, { message: '发布修订与构建快照不一致' });
      const [candidate] = await tx.select({ publishedAt: sql<Date | null>`cms_contents.published_at`.mapWith(cmsContents.publishedAt) }).from(sql.raw(`"${cmsGenerationSchemaName(deployment.id)}".cms_content_projection AS cms_contents`)).where(eq(cmsContents.id, revision.contentId)).limit(1);
      await applyCmsRevisionProjection(tx, revision, { publishedAt: candidate?.publishedAt ?? now, generationId: deployment.id });
      await markCmsRevisionPublished(tx, revision.contentId, revision.id);
    }
    if (rollback) await restoreProjection(tx, locked.siteId, deployment.id, current, []);
    else for (const item of locked.items.filter((entry) => entry.action === 'withdraw')) {
      await tx.update(cmsContents).set({ status: 'offline', scheduledAt: null, version: sql`${cmsContents.version}+1` }).where(eq(cmsContents.id, item.contentId));
    }
    if (rollback) for (const contentId of affectedIds) {
      await tx.update(cmsContents).set({ version: sql`${cmsContents.version}+1` }).where(eq(cmsContents.id, contentId));
      const revisionId = nextRevisions.get(contentId);
      if (revisionId) await tx.update(cmsContentWorkingCopies).set({ publishedRevisionId: revisionId }).where(eq(cmsContentWorkingCopies.contentId, contentId));
    }
    if (current) {
      await tx.update(cmsDeployments).set({ status: 'retired' }).where(eq(cmsDeployments.id, current));
      await tx.update(cmsReleases).set({ status: 'superseded' }).where(and(eq(cmsReleases.siteId, locked.siteId), eq(cmsReleases.status, 'active')));
    }
    await tx.insert(cmsSiteGenerations).values({ siteId: locked.siteId, activeGenerationId: deployment.id, revision: 1 }).onConflictDoUpdate({ target: cmsSiteGenerations.siteId, set: { activeGenerationId: deployment.id, revision: sql`${cmsSiteGenerations.revision}+1`, updatedAt: now } });
    await tx.update(cmsDeployments).set({ status: 'active', activatedAt: now, error: null }).where(eq(cmsDeployments.id, deployment.id));
    const [updated] = await tx.update(cmsReleases).set({ status: 'active', error: null }).where(eq(cmsReleases.id, id)).returning();
    const actor = currentUserOrNull();
    const [activation] = await tx.insert(cmsReleaseActivations).values({ siteId: locked.siteId, releaseId: locked.id, fromGenerationId: current, toGenerationId: deployment.id, action: rollback ? 'rollback' : 'activate', operatorId: actor?.userId ?? null, operatorName: actor?.username ?? '系统' }).returning();
    const webhooks = [];
    const notifications = [];
    const effects = [];
    for (const contentId of affectedIds) {
      const [content] = await tx.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
      if (content) {
        webhooks.push(await insertCmsContentWebhookOutbox(tx, content.status === 'published' ? 'cms.content.published' : 'cms.content.offline', content));
        await logContentOp(tx, content.id, content.status === 'published' ? 'published' : 'offlined', `${rollback ? '回滚' : '激活'}发布单 #${locked.id}，激活记录 #${activation.id}`);
        if (content.status === 'published') notifications.push(await insertCmsSubscriptionNotificationOutbox(tx, content));
        effects.push(await persistAsyncTask(tx, { taskType: 'cms-publication-effects', title: `内容交付：${content.title}`, tenantId: null, payload: { contentId: content.id, contentVersion: content.version, activationId: activation.id, siteId: locked.siteId }, idempotencyKey: `cms-publication-effects:${activation.id}:${content.id}` }));
      }
    }
    const cdnTask = await insertCmsCdnPurgeOutbox(tx, locked.siteId, `activation:${activation.id}`);
    return { release: updated, webhooks, notifications, effects, cdnTaskId: cdnTask.id };
  });
  invalidateSiteCache();
  await invalidateCmsSiteCaches(release.siteId);
  await enqueueCmsWebhookEvents(result.webhooks);
  await Promise.all(result.notifications.map(enqueueCmsSubscriptionNotification));
  await Promise.all(result.effects.map((task) => enqueueAsyncTask(task.id).catch(() => undefined)));
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
  const row = await requireCmsContentAccess(contentId);
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
      const releaseSlot = await acquireGenerationBuildSlot();
      try {
        const [existingDeployment] = await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, deploymentId)).limit(1);
        if (existingDeployment?.status !== 'ready') await db.transaction(async (tx) => {
          await createCmsGenerationStorage(tx, release.siteId, deploymentId, release.baseGenerationId, release.configurationSnapshot);
          const revisions: Awaited<ReturnType<typeof loadCmsPublishableRevision>>[] = [];
          for (const item of release.items) if (item.revisionId) revisions.push(await loadCmsPublishableRevision(tx, item.revisionId));
          const existingRevisions = await tx.select({ contentId: cmsContentWorkingCopies.contentId, revisionId: cmsContentRevisions.id, hash: cmsContentRevisions.hash })
            .from(cmsContentWorkingCopies).innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
            .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.publishedRevisionId)).where(eq(cmsContents.siteId, release.siteId));
          const revisionMap = new Map(existingRevisions.map((entry) => [entry.contentId, entry]));
          for (const revision of revisions) revisionMap.set(revision.contentId, { contentId: revision.contentId, revisionId: revision.id, hash: revision.hash });
          await tx.execute(sql`select set_config('search_path', ${`${cmsGenerationSchemaName(deploymentId)},public`}, true)`);
          await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: release.siteId, generationId: deploymentId, candidate: true }, async () => {
            await reloadCmsSearchDict(release.siteId);
            for (const revision of revisions) {
              const [channel] = await tx.select({ id: cmsChannels.id }).from(cmsChannels).where(and(eq(cmsChannels.siteId, release.siteId), eq(cmsChannels.id, revision.payload.channelId), eq(cmsChannels.status, 'enabled'))).limit(1);
              if (!channel) throw new HTTPException(409, { message: '修订目标栏目未包含在候选公开配置中，请将栏目配置一并发布' });
              await applyCmsRevisionProjection(tx, revision, { publishedAt: release.activateAt ?? new Date(), generationId: deploymentId, candidate: true });
            }
            const withdrawIds = release.items.filter((item) => item.action === 'withdraw').map((item) => item.contentId);
            if (withdrawIds.length) await tx.update(cmsContents).set({ status: 'offline' }).where(inArray(cmsContents.id, withdrawIds));
            await assertCmsReleaseDependencies(tx, release.siteId);
            await rebuildSearchIndex({ siteId: release.siteId });
            const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, release.siteId)).limit(1);
            await buildSiteStatic(release.siteId, async (progress) => {
              const result = await withoutDbExecutor(() => ctx.progress({ processed: progress.processed, total: progress.total, note: progress.note }));
              const [currentRelease] = await withoutDbExecutor(() => db.select({ status: cmsReleases.status }).from(cmsReleases).where(eq(cmsReleases.id, releaseId)).limit(1));
              if (currentRelease?.status === 'cancelled') throw new Error('发布单已取消');
              if (result.cancelRequested) throw new Error('发布构建已取消');
              return false;
            });
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
        const activated = ready?.autoActivate && status === 'ready' ? await activateCmsRelease(releaseId, release.baseGenerationId) : null;
        return { releaseId, deploymentId, status: activated?.status ?? ready?.status ?? 'cancelled' };
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
