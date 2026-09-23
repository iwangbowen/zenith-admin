import { eq, and, inArray, isNull, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSites, cmsContents, cmsContentTags, cmsContentTombstones, cmsTags, cmsCollectItems, cmsContentWorkingCopies, cmsContentRevisions, cmsContentRevisionApprovals, cmsContentReviewRevisions } from '../../db/schema';
import type { CmsContentRow, CmsSiteRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { assertChannelAccess } from './cms-channels.service';
import { logContentOp, logContentOps } from './cms-content-op-logs.service';
import { assertSiteAccess } from './cms-sites.service';
import { hasPermission } from '../../lib/context';
import type { Permission } from '@zenith/shared/core';
import type { AsyncTask } from '@zenith/shared/tasks';
import { resolveCmsSiteOpsSettings } from './cms-site-settings';
import { assertCompleteCmsBatch } from './cms-access';
import { assertCmsContentsUnlocked, assertNoLockedCmsMappedCopies } from './cms-content-lock.service';
import { bumpCmsTemplateRefsRevision, lockCmsSitesForRows } from './cms-site-publish-lock.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import { adoptCmsResourcesIntoSite, deleteCmsResourceRefsForOwner } from './cms-resource-refs.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import logger from '../../lib/logger';
import { assertCmsWidgetSourcesMutable } from './cms-widgets.service';
import { enqueueCmsWebhookEvents, insertCmsContentWebhookOutbox } from './cms-webhook.service';
import { insertContentPublishOutbox, recalcTagContentCounts, ensureChannelForContent } from './cms-contents-internal';
import { offlineCmsContent, publishCmsContent, rejectCmsContent, submitCmsContent, createCmsContent } from './cms-contents-write.service';
import { buildWhere } from '../../lib/where-helpers';
import { requireCmsContentAccess, requireCmsContentsAccess } from './cms-content-access.service';
import { assertCmsContentVersion, requireCmsWorkingCopy, snapshotCmsContentProjection } from './cms-content-revisions.service';
import type { CmsContentRevisionSnapshot } from '@zenith/shared/cms';

// ─── 回收站 ───────────────────────────────────────────────────────────────────
async function assertBatchSiteAccess(ids: number[]): Promise<void> {
  await requireCmsContentsAccess(ids);
  await assertCmsContentsUnlocked(ids);
}

type ExpectedVersions = Record<string, number>;

async function consumeBatchVersions(tx: DbTransaction, ids: number[], expectedVersions?: ExpectedVersions) {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const working = await requireCmsWorkingCopy(tx, id, true);
    assertCmsContentVersion(working, expectedVersions?.[String(id)]);
    await tx.update(cmsContentWorkingCopies).set({ version: sql`${cmsContentWorkingCopies.version} + 1` }).where(eq(cmsContentWorkingCopies.contentId, id));
  }
}

async function currentBatchVersions(ids: number[]): Promise<ExpectedVersions> {
  if (!ids.length) return {};
  const rows = await db.select({ id: cmsContentWorkingCopies.contentId, version: cmsContentWorkingCopies.version }).from(cmsContentWorkingCopies).where(inArray(cmsContentWorkingCopies.contentId, ids));
  return Object.fromEntries(rows.map((row) => [String(row.id), row.version]));
}

async function mutateWorkingCopies(ids: number[], expectedVersions: ExpectedVersions | undefined, change: (snapshot: CmsContentRevisionSnapshot, identity: CmsContentRow, tx: DbTransaction) => Promise<CmsContentRevisionSnapshot>) {
  const identities = await requireCmsContentsAccess(ids);
  await assertCmsContentsUnlocked(ids);
  return db.transaction(async (tx) => {
    await lockCmsSitesForRows(tx, identities);
    for (const identity of [...identities].sort((a, b) => a.id - b.id)) {
      if (identity.deletedAt || identity.archivedAt) throw new HTTPException(409, { message: '所选内容含已回收或归档内容' });
      const working = await requireCmsWorkingCopy(tx, identity.id, true);
      assertCmsContentVersion(working, expectedVersions?.[String(identity.id)]);
      const snapshot = await change(working.snapshot, identity, tx);
      await tx.update(cmsContentWorkingCopies).set({ snapshot, editorialStatus: 'draft', version: sql`${cmsContentWorkingCopies.version} + 1` }).where(eq(cmsContentWorkingCopies.contentId, identity.id));
      await logContentOp(tx, identity.id, 'updated', '批量更新工作稿，公开版本保持不变');
    }
    return identities.length;
  });
}

/**
 * 内容批量变更后为「带详情模板」的内容所在站点各入一条模板引用重建 outbox：
 * 先 bump 站点的 templateRefsRevision（并回写 `sites` 里的站点行，后续入队读到新版本号），
 * 事件键 `site:{siteId}:refs:{revision}` 保证同一版本只重建一次。
 */
async function enqueueTemplateRefsRebuild(
  tx: DbTransaction,
  sites: Map<number, CmsSiteRow>,
  rows: ReadonlyArray<Pick<CmsContentRow, 'siteId' | 'detailTemplate'>>,
  reason: string,
): Promise<AsyncTask[]> {
  const tasks: AsyncTask[] = [];
  for (const siteId of new Set(rows.filter((row) => row.detailTemplate).map((row) => row.siteId))) {
    const revision = await bumpCmsTemplateRefsRevision(tx, siteId);
    const site = { ...sites.get(siteId)!, templateRefsRevision: revision };
    sites.set(siteId, site);
    tasks.push(await insertCmsSiteRefsRebuildOutbox(tx, site, reason, `site:${siteId}:refs:${revision}`));
  }
  return tasks;
}

export async function recycleCmsContents(ids: number[], expectedVersions?: ExpectedVersions) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  await assertCmsWidgetSourcesMutable('content', ids);
  await assertNoLockedCmsMappedCopies(ids);
  const initial = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId }).from(cmsContents)
    .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt)));
  const mutation = await db.transaction(async (tx) => {
    const sites = await lockCmsSitesForRows(tx, initial);
    await consumeBatchVersions(tx, ids, expectedVersions);
    const locked = await tx.select().from(cmsContents)
      .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
      .for('update');
    await assertCmsWidgetSourcesMutable('content', locked.map((row) => row.id), tx);
    const oldSnapshots = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of locked) {
      oldSnapshots.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const rows = await tx.update(cmsContents)
      .set({ deletedAt: new Date(), status: 'offline', version: sql`${cmsContents.version} + 1` })
      .where(and(inArray(cmsContents.id, locked.map((row) => row.id)), isNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
      .returning();
    const refsTasks = await enqueueTemplateRefsRebuild(tx, sites, rows, '回收内容模板引用移除');
    await logContentOps(tx, rows.map((row) => ({ id: row.id })), 'recycled');
    const tasks: AsyncTask[] = [];
    const webhookTasks: (AsyncTask | null)[] = [];
    for (const row of rows) {
      tasks.push(await insertContentPublishOutbox(
        tx,
        sites.get(row.siteId)!,
        row,
        'recycle',
        oldSnapshots.get(row.id)?.deletePaths ?? [],
        { build: false },
      ));
      webhookTasks.push(await insertCmsContentWebhookOutbox(tx, 'cms.content.recycled', row));
    }
    return { rows, tasks: [...tasks, ...refsTasks], webhookTasks };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容批量回收');
  await enqueueCmsWebhookEvents(mutation.webhookTasks);
  for (const row of mutation.rows) {
    void import('./cms-distributions.service')
      .then(({ submitCmsMappingDistributionSideEffects }) => submitCmsMappingDistributionSideEffects(row.id))
      .catch((error) => logger.warn(`[cms-distribution] 内容 #${row.id} 回收后的映射任务提交失败`, error));
  }
  return mutation.rows.length;
}

export async function restoreCmsContents(ids: number[], expectedVersions?: ExpectedVersions) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const initial = await db.select({ siteId: cmsContents.siteId }).from(cmsContents).where(inArray(cmsContents.id, ids));
  const mutation = await db.transaction(async (tx) => {
    const sites = await lockCmsSitesForRows(tx, initial);
    await consumeBatchVersions(tx, ids, expectedVersions);
    const rows = await tx.update(cmsContents)
      .set({ deletedAt: null, status: 'draft' })
      .where(and(inArray(cmsContents.id, ids), isNotNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
      .returning();
    const tasks = await enqueueTemplateRefsRebuild(tx, sites, rows, '恢复内容模板引用');
    await logContentOps(tx, rows.map((row) => ({ id: row.id })), 'restored');
    return { count: rows.length, tasks };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容恢复');
  return mutation.count;
}

/** 彻底删除（仅限回收站中的内容）；被映射引用的正文先物化到映射行，避免映射内容失源 */
export async function purgeCmsContents(ids: number[], options?: { skipAccessCheck?: boolean; expectedVersions?: ExpectedVersions }) {
  if (ids.length === 0) return 0;
  if (options?.skipAccessCheck) await assertCmsContentsUnlocked(ids);
  else await assertBatchSiteAccess(ids);
  await assertCmsWidgetSourcesMutable('content', ids);
  const targets = await db.select().from(cmsContents)
    .where(and(inArray(cmsContents.id, ids), isNotNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)));
  if (targets.length === 0) return 0;
  const targetIds = targets.map((t) => t.id);
  const [approved] = await db.select({ id: cmsContentRevisionApprovals.id }).from(cmsContentRevisionApprovals)
    .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentRevisionApprovals.revisionId))
    .where(inArray(cmsContentRevisions.contentId, targetIds)).limit(1);
  const [reviewed] = await db.select({ id: cmsContentReviewRevisions.id }).from(cmsContentReviewRevisions)
    .where(inArray(cmsContentReviewRevisions.contentId, targetIds)).limit(1);
  if (approved || reviewed) throw new HTTPException(409, { message: '内容包含已批准或已审阅修订，须按修订保留策略归档，不能彻底删除' });
  const mutation = await db.transaction(async (tx) => {
    const sites = await lockCmsSitesForRows(tx, targets);
    await consumeBatchVersions(tx, ids, options?.expectedVersions);
    const lockedTargets = await tx.select().from(cmsContents).where(and(
      inArray(cmsContents.id, targetIds),
      isNotNull(cmsContents.deletedAt),
      isNull(cmsContents.lockedAt),
    )).for('update');
    await assertCmsWidgetSourcesMutable('content', lockedTargets.map((row) => row.id), tx);
    const captured = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of lockedTargets) {
      captured.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const lockedIds = lockedTargets.map((row) => row.id);
    if (lockedIds.length === 0) return { count: 0, tasks: [] as AsyncTask[], webhookTasks: [] as (AsyncTask | null)[] };
    // Mapping targets already contain a local snapshot; source purge only
    // detaches the governance relation and never reads cross-site payloads.
    const mappedRows = await tx.select({ id: cmsContents.id, siteId: cmsContents.siteId, mappingSourceId: cmsContents.mappingSourceId, lockedAt: cmsContents.lockedAt, lockReason: cmsContents.lockReason })
     .from(cmsContents).where(inArray(cmsContents.mappingSourceId, lockedIds));
    const lockedMapped = mappedRows.find((row) => row.lockedAt);
    if (lockedMapped) throw new HTTPException(423, { message: `映射内容 #${lockedMapped.id} 已被持久锁定${lockedMapped.lockReason ? `：${lockedMapped.lockReason}` : ''}` });
    await lockCmsSitesForRows(tx, mappedRows, sites);
    const lockedMappingRows = mappedRows.filter((row) => !row.lockedAt);
    if (lockedMappingRows.length > 0) {
      await tx.update(cmsContents).set({
        mappingSourceId: null,
        distributionRuleId: null,
        distributionSourceId: null,
        distributionSourceVersion: null,
        version: sql`${cmsContents.version} + 1`,
      }).where(inArray(cmsContents.id, lockedMappingRows.map((row) => row.id)));
    }
    await tx.update(cmsCollectItems)
      .set({ contentId: null })
      .where(inArray(cmsCollectItems.contentId, lockedIds));
    const tagRows = await tx.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags)
      .where(inArray(cmsContentTags.contentId, lockedIds));
    // 版本行随内容级联删除，但引用索引不是外键关系，需显式清理，否则素材永远判不出孤立
    const versionIds = await tx.select({ id: cmsContentRevisions.id, contentId: cmsContentRevisions.contentId }).from(cmsContentRevisions)
      .where(inArray(cmsContentRevisions.contentId, lockedIds));
    // Content ids can span multiple sites in a batch; keep ref cleanup scoped
    // per site so an identical owner id from another site is never touched.
    for (const siteId of new Set(lockedTargets.map((row) => row.siteId))) {
      const contentIds = lockedTargets.filter((row) => row.siteId === siteId).map((row) => row.id);
      const versionIdsForSite = versionIds
        .filter((version) => contentIds.includes(version.contentId))
        .map((version) => version.id);
      await deleteCmsResourceRefsForOwner(tx, 'contentVersion', versionIdsForSite, siteId);
      await deleteCmsResourceRefsForOwner(tx, 'content', contentIds, siteId);
    }
    // 墓碑：硬删除后行本身消失，Headless 增量同步只能靠它输出 op=delete，
    // 否则客户端按 updated_at 游标永远拉不到这条变更，本地缓存会残留已删内容
    await tx.insert(cmsContentTombstones)
      .values(lockedTargets.map((row) => ({ siteId: row.siteId, contentId: row.id })))
      .onConflictDoNothing();
    await tx.delete(cmsContents).where(inArray(cmsContents.id, lockedIds));
    await recalcTagContentCounts(tx, tagRows.map((t) => t.tagId));
    const refsTasks = await enqueueTemplateRefsRebuild(tx, sites, lockedTargets, '彻底删除内容模板引用');
    const tasks: AsyncTask[] = [];
    const webhookTasks: (AsyncTask | null)[] = [];
    for (const row of lockedTargets) {
      const old = captured.get(row.id)!;
      tasks.push(await insertContentPublishOutbox(
        tx,
        sites.get(row.siteId)!,
        row,
        'purge',
        old.deletePaths,
        { build: false, purged: true, snapshot: old.snapshot },
      ));
      webhookTasks.push(await insertCmsContentWebhookOutbox(tx, 'cms.content.deleted', row));
    }
    return { count: lockedIds.length, tasks: [...tasks, ...refsTasks], webhookTasks };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容彻底删除');
  await enqueueCmsWebhookEvents(mutation.webhookTasks);
  return mutation.count;
}

// ─── 归档（前台详情保留，不参与列表聚合；仅已发布/已下线内容可归档）──────────────
async function setCmsContentsArchived(ids: number[], archived: boolean, expectedVersions?: ExpectedVersions): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  if (archived) {
    await assertNoLockedCmsMappedCopies(ids);
  }
  const initial = await db.select().from(cmsContents).where(inArray(cmsContents.id, ids));
  const mutation = await db.transaction(async (tx) => {
    const sites = await lockCmsSitesForRows(tx, initial);
    await consumeBatchVersions(tx, ids, expectedVersions);
    const archivedCondition = archived ? isNull(cmsContents.archivedAt) : isNotNull(cmsContents.archivedAt);
    const locked = await tx.select().from(cmsContents).where(buildWhere(
      inArray(cmsContents.id, ids),
      isNull(cmsContents.deletedAt),
      archivedCondition,
      isNull(cmsContents.lockedAt),
      ...(archived ? [inArray(cmsContents.status, ['published', 'offline'])] : []),
    )).for('update');
    if (!locked.length) return { rows: [] as CmsContentRow[], tasks: [] as AsyncTask[] };
    const oldSnapshots = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of locked.filter((item) => item.status === 'published')) {
      oldSnapshots.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const rows = await tx.update(cmsContents)
      .set({ archivedAt: archived ? new Date() : null, version: sql`${cmsContents.version} + 1` })
      .where(inArray(cmsContents.id, locked.map((row) => row.id)))
      .returning();
    await logContentOps(tx, rows.map((row) => ({ id: row.id })), archived ? 'archived' : 'unarchived');
    const tasks: AsyncTask[] = [];
    for (const row of rows.filter((item) => oldSnapshots.has(item.id))) {
      tasks.push(await insertContentPublishOutbox(
        tx,
        sites.get(row.siteId)!,
        row,
        archived ? 'archive' : 'unarchive',
        oldSnapshots.get(row.id)!.deletePaths,
        { build: true },
      ));
    }
    return { rows, tasks };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, archived ? '内容归档' : '内容取消归档');
  for (const row of mutation.rows) {
    void import('./cms-distributions.service')
      .then(({ submitCmsMappingDistributionSideEffects }) => submitCmsMappingDistributionSideEffects(row.id))
      .catch((error) => logger.warn(`[cms-distribution] 内容 #${row.id} 归档状态变更后的映射任务提交失败`, error));
  }
  return mutation.rows.length;
}

export async function archiveCmsContents(ids: number[], expectedVersions?: ExpectedVersions) {
  return setCmsContentsArchived(ids, true, expectedVersions);
}

export async function unarchiveCmsContents(ids: number[], expectedVersions?: ExpectedVersions) {
  return setCmsContentsArchived(ids, false, expectedVersions);
}

export function canAutoOfflineCmsContent(
  row: Pick<CmsContentRow, 'status' | 'expireAt' | 'deletedAt' | 'lockedAt'>,
  now: Date,
): boolean {
  return row.status === 'published'
    && row.expireAt !== null
    && row.expireAt.getTime() <= now.getTime()
    && row.deletedAt === null
    && row.lockedAt === null;
}

/** 过期下线：被已发布页面部件引用的内容保持线上，并显式返回阻塞清单供调度日志告警。 */
export async function offlineExpiredCmsContents(now = new Date()): Promise<{ offlined: number[]; blocked: number[] }> {
  const rows = await db.select({ id: cmsContents.id }).from(cmsContents).where(and(
      isNotNull(cmsContents.expireAt),
      lte(cmsContents.expireAt, now),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.lockedAt),
    ));
  const completed: number[] = [];
  const blocked: number[] = [];
  for (const row of rows) {
    try {
      await offlineCmsContent(row.id, { skipAccessCheck: true, expireAtBefore: now, expectedVersion: (await requireCmsWorkingCopy(db, row.id)).version });
      completed.push(row.id);
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 409) throw error;
      blocked.push(row.id);
      logger.warn(`[CMS] 内容 #${row.id} 已到期但下线被阻止：${error.message}`);
    }
  }
  return { offlined: completed, blocked };
}

/** 置顶到期自动取消：topExpireAt 到期的置顶内容取消置顶；返回受影响内容 id（供静态刷新） */
export async function cancelExpiredTopContents(now = new Date()): Promise<number[]> {
  const initial = await db.select().from(cmsContents).where(and(
      eq(cmsContents.isTop, true),
      isNotNull(cmsContents.topExpireAt),
      lte(cmsContents.topExpireAt, now),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.lockedAt),
    ));
  if (!initial.length) return [];
  const mutation = await db.transaction(async (tx) => {
    const sites = await lockCmsSitesForRows(tx, initial);
    const locked = await tx.select().from(cmsContents).where(and(
      inArray(cmsContents.id, initial.map((row) => row.id)),
      eq(cmsContents.isTop, true),
      isNotNull(cmsContents.topExpireAt),
      lte(cmsContents.topExpireAt, now),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.lockedAt),
    )).for('update');
    if (!locked.length) return { rows: [] as CmsContentRow[], tasks: [] as AsyncTask[] };
    const oldSnapshots = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of locked.filter((item) => item.status === 'published')) {
      oldSnapshots.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const rows = await tx.update(cmsContents)
      .set({ isTop: false, topWeight: 0, topExpireAt: null, version: sql`${cmsContents.version} + 1` })
      .where(inArray(cmsContents.id, locked.map((row) => row.id)))
      .returning();
    await logContentOps(tx, rows.map((row) => ({ id: row.id })), 'updated', '置顶到期自动取消');
    const tasks: AsyncTask[] = [];
    for (const row of rows.filter((item) => oldSnapshots.has(item.id))) {
      tasks.push(await insertContentPublishOutbox(
        tx,
        sites.get(row.siteId)!,
        row,
        'top-expired',
        oldSnapshots.get(row.id)!.deletePaths,
        { build: true },
      ));
    }
    return { rows, tasks };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容置顶到期');
  return mutation.rows.map((row) => row.id);
}

// ═══ P3 Batch1 ════════════════════════════════════════════════════════════════

/** Moving changes the draft placement, never its content type or current publication. */
export async function batchMoveCmsContents(ids: number[], channelId: number, expectedVersions?: ExpectedVersions): Promise<number> {
  await assertChannelAccess(channelId);
  return mutateWorkingCopies(ids, expectedVersions, async (snapshot, identity) => {
    await ensureChannelForContent(identity.siteId, channelId);
    return { ...snapshot, channelId, extraChannelIds: snapshot.extraChannelIds.filter((id) => id !== channelId) };
  });
}

export async function batchSetCmsContentFlags(ids: number[], flags: { isTop?: boolean; isRecommend?: boolean; isHot?: boolean; isOriginal?: boolean }, expectedVersions?: ExpectedVersions): Promise<number> {
  return mutateWorkingCopies(ids, expectedVersions, async (snapshot) => ({ ...snapshot, ...flags }));
}

const CMS_BATCH_STATUS_PERMISSIONS: Record<'submit' | 'publish' | 'reject' | 'offline', Permission> = {
  submit: 'cms:content:update',
  publish: 'cms:content:publish',
  offline: 'cms:content:publish',
  reject: 'cms:content:audit',
};

/**
 * 批量状态流转（提审/发布/驳回/下线）。
 * 逐条复用单内容管道（各自独立事务与状态机校验），返回部分成功明细，
 * 单条失败不中断整批。
 */
export async function batchTransitionCmsContents(
  ids: number[],
  action: 'submit' | 'publish' | 'reject' | 'offline',
  reason?: string,
  expectedVersions?: ExpectedVersions,
): Promise<{ okIds: number[]; failed: { id: number; reason: string }[] }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { okIds: [], failed: [] };
  if (!(await hasPermission(CMS_BATCH_STATUS_PERMISSIONS[action]))) {
    throw new HTTPException(403, { message: '权限不足' });
  }
  const okIds: number[] = [];
  const failed: { id: number; reason: string }[] = [];
  for (const id of unique) {
    try {
      if (action === 'submit') await submitCmsContent(id, { expectedVersion: expectedVersions?.[String(id)] });
      else if (action === 'publish') await publishCmsContent(id, { expectedVersion: expectedVersions?.[String(id)] });
      else if (action === 'reject') await rejectCmsContent(id, reason?.trim() || '批量驳回', { expectedVersion: expectedVersions?.[String(id)] });
      else await offlineCmsContent(id, { expectedVersion: expectedVersions?.[String(id)] });
      okIds.push(id);
    } catch (err) {
      const message = err instanceof HTTPException ? err.message : '操作失败';
      failed.push({ id, reason: message });
      if (!(err instanceof HTTPException)) logger.warn(`[cms] 批量${action} 内容 #${id} 失败`, err);
    }
  }
  return { okIds, failed };
}

export async function batchAddCmsContentTags(ids: number[], tagIds: number[], expectedVersions?: ExpectedVersions): Promise<number> {
  return mutateWorkingCopies(ids, expectedVersions, async (snapshot, identity, tx) => {
    const tags = await tx.select({ id: cmsTags.id }).from(cmsTags).where(and(inArray(cmsTags.id, tagIds), eq(cmsTags.siteId, identity.siteId)));
    assertCompleteCmsBatch(tagIds, tags.map((row) => row.id), '标签');
    return { ...snapshot, tagIds: [...new Set([...snapshot.tagIds, ...tagIds])] };
  });
}

export async function duplicateCmsContent(id: number, targetChannelId?: number) {
  const current = await requireCmsContentAccess(id);
  const working = await requireCmsWorkingCopy(db, id);
  const snapshot = working.snapshot;
  return createCmsContent({ ...snapshot, siteId: current.siteId, channelId: targetChannelId ?? snapshot.channelId,
    title: `${snapshot.title}（副本）`.slice(0, 255), slug: null, staticPath: null, scheduledAt: null,
  });
}

export async function distributeCmsContents(ids: number[], targetSiteId: number, targetChannelId: number): Promise<number> {
  const sources = await requireCmsContentsAccess(ids);
  await assertSiteAccess(targetSiteId);
  await assertChannelAccess(targetChannelId);
  const channel = await ensureChannelForContent(targetSiteId, targetChannelId);
  let count = 0;
  for (const row of sources) {
    if (row.siteId === targetSiteId) continue;
    if (row.status !== 'published' || row.deletedAt || row.archivedAt) throw new HTTPException(409, { message: '仅可分发已发布内容' });
    const snapshot = await snapshotCmsContentProjection(db, row);
    const adopted = await adoptCmsResourcesIntoSite(db, targetSiteId, snapshot);
    await createCmsContent({ ...snapshot, ...adopted, modelId: channel.modelId, siteId: targetSiteId, channelId: targetChannelId,
      tagIds: [], extraChannelIds: [], relatedIds: [], slug: null, staticPath: null, scheduledAt: null });
    count++;
  }
  return count;
}

/** Retention cleanup uses an explicitly captured system CAS rather than bypassing concurrency checks. */
export async function cleanupCmsRecycleBin(): Promise<number> {
  const sites = await db.select({ id: cmsSites.id, settings: cmsSites.settings }).from(cmsSites);
  const now = Date.now();
  // 按保留天数分组：站点绝大多数沿用同一份默认配置，分组后通常只剩一条 OR 分支，
  // 替代「每个站点各扫一次回收站」
  const siteIdsByKeepDays = new Map<number, number[]>();
  for (const site of sites) {
    const keepDays = resolveCmsSiteOpsSettings(site.settings).recycleKeepDays;
    if (keepDays <= 0) continue;
    const list = siteIdsByKeepDays.get(keepDays);
    if (list) list.push(site.id);
    else siteIdsByKeepDays.set(keepDays, [site.id]);
  }
  if (siteIdsByKeepDays.size === 0) return 0;
  const expiredInGroup = [...siteIdsByKeepDays].map(([keepDays, siteIds]) => and(
    inArray(cmsContents.siteId, siteIds),
    lt(cmsContents.deletedAt, new Date(now - keepDays * 24 * 60 * 60 * 1000)),
  ));
  const rows = await db.select({ id: cmsContents.id }).from(cmsContents).where(and(
    isNotNull(cmsContents.deletedAt),
    isNull(cmsContents.lockedAt),
    or(...expiredInGroup),
  ));
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  return purgeCmsContents(ids, { skipAccessCheck: true, expectedVersions: await currentBatchVersions(ids) });
}
