import { cmsModelVersions } from '../../db/schema/cms-design';
import { createHash } from 'node:crypto';
import { and, eq, max, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsContentRevisionSnapshotSchema, cmsEditorialStatusAfterPublication, type CmsContentRevisionSnapshot, type CmsRevisionKind } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsContents, cmsContentTags, cmsContentChannels, cmsContentRelations, cmsContentRevisions, cmsContentWorkingCopies, cmsContentReviewRevisions, cmsContentRevisionApprovals } from '../../db/schema';
import type { CmsContentRow, CmsContentRevisionRow, CmsContentWorkingCopyRow } from '../../db/schema';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { parseDateTimeInput, formatDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { recalcTagContentCounts } from './cms-contents-internal';
import { syncCmsResourceRefs } from './cms-resource-refs.service';
import { contentSearchVector, extendSearchTexts } from './cms-search.service';
import { claimCmsUniqueModelValues, freezeCmsRevisionDependencies } from './cms-revision-dependencies.service';
import { normalizeCmsContentDocument } from './cms-document.service';
import { stableStringify } from '@zenith/shared/core';

const DATE_FIELDS = ['scheduledAt', 'expireAt', 'topExpireAt', 'dueAt'] as const;

export function canonicalCmsJson(value: unknown): string {
  return stableStringify(JSON.parse(JSON.stringify(value ?? null)));
}

export function cmsRevisionHash(snapshot: CmsContentRevisionSnapshot): string {
  return createHash('sha256').update(canonicalCmsJson(snapshot)).digest('hex');
}

/** Snapshot every editable field and relationship through the shared create schema. */
export function buildCmsRevisionSnapshot(row: Record<string, unknown>, relations: { tagIds?: number[]; extraChannelIds?: number[]; relatedIds?: number[] } = {}): CmsContentRevisionSnapshot {
  const values: Record<string, unknown> = { ...row, ...relations };
  for (const field of DATE_FIELDS) if (values[field] instanceof Date) values[field] = formatDateTime(values[field] as Date);
  return cmsContentRevisionSnapshotSchema.parse(values);
}

export async function snapshotCmsContentProjection(executor: DbExecutor, row: CmsContentRow): Promise<CmsContentRevisionSnapshot> {
  const [tags, channels, related] = await Promise.all([
    executor.select({ id: cmsContentTags.tagId }).from(cmsContentTags).where(eq(cmsContentTags.contentId, row.id)),
    executor.select({ id: cmsContentChannels.channelId }).from(cmsContentChannels).where(eq(cmsContentChannels.contentId, row.id)),
    executor.select({ id: cmsContentRelations.relatedId }).from(cmsContentRelations).where(eq(cmsContentRelations.contentId, row.id)).orderBy(cmsContentRelations.sort),
  ]);
  return buildCmsRevisionSnapshot(row, { tagIds: tags.map((v) => v.id), extraChannelIds: channels.map((v) => v.id), relatedIds: related.map((v) => v.id) });
}

export async function initializeCmsContentWorkingCopy(executor: DbExecutor, row: CmsContentRow, snapshot?: CmsContentRevisionSnapshot): Promise<CmsContentWorkingCopyRow> {
  const value = snapshot ?? await snapshotCmsContentProjection(executor, row);
  const [working] = await executor.insert(cmsContentWorkingCopies).values({ contentId: row.id, snapshot: value, version: 1 }).returning();
  return requireRow(working, '工作稿创建失败');
}

export async function requireCmsWorkingCopy(executor: DbExecutor, contentId: number, lock = false): Promise<CmsContentWorkingCopyRow> {
  const query = executor.select().from(cmsContentWorkingCopies).where(eq(cmsContentWorkingCopies.contentId, contentId)).limit(1);
  const [working] = lock ? await query.for('update') : await query;
  return requireRow(working, '内容缺少工作稿，请重新创建内容', 409);
}

export function assertCmsContentVersion(working: Pick<CmsContentWorkingCopyRow, 'version'>, expectedVersion: number | undefined): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion !== working.version) throw new HTTPException(409, { message: '内容版本已变化或缺少版本号，请获取最新工作稿后合并修改' });
}

export function cmsRevisionToContentRow(identity: CmsContentRow, snapshot: CmsContentRevisionSnapshot): CmsContentRow {
  const { tagIds: _tags, extraChannelIds: _channels, relatedIds: _related, bodyDocument: _document, modelVersionId: _modelVersion, assetVersions: _assets, ...fields } = snapshot;
  return { ...identity, ...fields, modelId: snapshot.modelId, modelVersionId: snapshot.modelVersionId, dueAt: parseDateTimeInput(snapshot.dueAt), scheduledAt: parseDateTimeInput(snapshot.scheduledAt), expireAt: parseDateTimeInput(snapshot.expireAt), topExpireAt: parseDateTimeInput(snapshot.topExpireAt) } as CmsContentRow;
}

export async function freezeCmsContentRevision(tx: DbTransaction, identity: CmsContentRow, working: CmsContentWorkingCopyRow, kind: CmsRevisionKind, remark?: string): Promise<CmsContentRevisionRow> {
  const frozen = await freezeCmsRevisionDependencies(tx, identity.siteId, working.snapshot.modelId, working.snapshot, { strict: kind === 'submission' || kind === 'publication' });
  const snapshot = cmsContentRevisionSnapshotSchema.parse({ ...frozen.snapshot, modelVersionId: frozen.schemaVersionId, assetVersions: frozen.assetVersions });
  await tx.update(cmsContentWorkingCopies).set({ snapshot }).where(eq(cmsContentWorkingCopies.contentId, identity.id));
  const [{ latest }] = await tx.select({ latest: max(cmsContentRevisions.version) }).from(cmsContentRevisions).where(eq(cmsContentRevisions.contentId, identity.id));
  const [revision] = await tx.insert(cmsContentRevisions).values({ contentId: identity.id, version: (latest ?? 0) + 1, sourceVersion: working.version, kind, hash: cmsRevisionHash(snapshot), title: snapshot.title, snapshot, remark: remark ?? null }).returning();
  requireRow(revision, '内容修订创建失败');
  await syncCmsResourceRefs(tx, 'contentVersion', revision.id, identity.siteId, { snapshot });
  return revision;
}

export async function loadCmsRevision(executor: DbExecutor, revisionId: number) {
  const [revision] = await executor.select().from(cmsContentRevisions).where(eq(cmsContentRevisions.id, revisionId)).limit(1);
  requireRow(revision, '内容修订不存在');
  if (cmsRevisionHash(revision.snapshot) !== revision.hash) throw new HTTPException(409, { message: '内容修订完整性校验失败' });
  const [identity] = await executor.select().from(cmsContents).where(eq(cmsContents.id, revision.contentId)).limit(1);
  requireRow(identity, '内容不存在');
  return { ...revision, siteId: identity.siteId, payload: cmsRevisionToContentRow(identity, revision.snapshot) };
}

export async function loadCmsPublishableRevision(executor: DbExecutor, revisionId: number, _options?: { allowPreviouslyPublished?: boolean }) {
  const revision = await loadCmsRevision(executor, revisionId);
  if (revision.payload.deletedAt || revision.payload.archivedAt || revision.payload.lockedAt) throw new HTTPException(409, { message: '内容已回收、归档或锁定，不允许发布' });
  const [approval] = await executor.select().from(cmsContentRevisionApprovals).where(eq(cmsContentRevisionApprovals.revisionId, revisionId)).limit(1);
  if (!approval || approval.hash !== revision.hash) throw new HTTPException(409, { message: '发布修订尚未批准或批准摘要不匹配' });
  return revision;
}

/** Only public projection tables are touched, so candidate builds can use a scoped executor. */
export async function applyCmsRevisionProjection(tx: DbTransaction, revision: Awaited<ReturnType<typeof loadCmsRevision>>, options: { publishedAt: Date; generationId?: number; candidate?: boolean }) {
  const { snapshot, contentId, payload } = revision;
  const { detectContentFlags } = await import('./cms-contents-write.service');
  if (!options.candidate) await claimCmsUniqueModelValues(tx, revision.siteId, contentId, snapshot);
  const { tagIds, extraChannelIds, relatedIds, bodyDocument: _document, modelVersionId: _modelVersion, assetVersions: _assets, ...fields } = snapshot;
  const [modelVersion] = snapshot.modelVersionId ? await tx.select().from(cmsModelVersions).where(eq(cmsModelVersions.id, snapshot.modelVersionId)).limit(1) : [];
  const searchableFields = new Set(modelVersion?.fields.filter((field) => field.searchable).map((field) => field.name) ?? []);
  const searchable = Object.fromEntries(Object.entries(snapshot.extend).filter(([name]) => searchableFields.has(name)));
  const oldTags = await tx.select({ id: cmsContentTags.tagId }).from(cmsContentTags).where(eq(cmsContentTags.contentId, contentId));
  const [row] = await tx.update(cmsContents).set({ ...fields, ...detectContentFlags(payload), modelVersionId: snapshot.modelVersionId, dueAt: payload.dueAt, scheduledAt: null, expireAt: payload.expireAt, topExpireAt: payload.topExpireAt, status: 'published', publishedAt: options.publishedAt, rejectReason: null, version: sql`${cmsContents.version} + 1`, searchVector: contentSearchVector(revision.siteId, payload, extendSearchTexts(searchable)) }).where(eq(cmsContents.id, contentId)).returning();
  requireRow(row, '内容不存在');
  await tx.delete(cmsContentTags).where(eq(cmsContentTags.contentId, contentId));
  if (tagIds.length) await tx.insert(cmsContentTags).values(tagIds.map((tagId) => ({ contentId, tagId })));
  await tx.delete(cmsContentChannels).where(eq(cmsContentChannels.contentId, contentId));
  if (extraChannelIds.length) await tx.insert(cmsContentChannels).values(extraChannelIds.filter((id) => id !== snapshot.channelId).map((channelId) => ({ contentId, channelId })));
  await tx.delete(cmsContentRelations).where(eq(cmsContentRelations.contentId, contentId));
  if (relatedIds.length) await tx.insert(cmsContentRelations).values(relatedIds.map((relatedId, sort) => ({ contentId, relatedId, sort })));
  await recalcTagContentCounts(tx, [...oldTags.map((v) => v.id), ...tagIds]);
  return row;
}

export async function markCmsRevisionPublished(tx: DbTransaction, contentId: number, revisionId: number | null): Promise<void> {
  const working = await requireCmsWorkingCopy(tx, contentId, true);
  const revision = revisionId ? await loadCmsRevision(tx, revisionId) : null;
  if (revision && revision.contentId !== contentId) throw new HTTPException(409, { message: '发布修订不属于当前内容' });
  await tx.update(cmsContentWorkingCopies).set({ publishedRevisionId: revisionId, editorialStatus: cmsEditorialStatusAfterPublication(working.editorialStatus, Boolean(revision && cmsRevisionHash(working.snapshot) === revision.hash)) }).where(eq(cmsContentWorkingCopies.contentId, contentId));
}

/** Trusted import/collection/member/distribution boundaries still carry a captured CAS token. */
export async function writeCmsSystemWorkingCopy(tx: DbTransaction, identity: CmsContentRow, patch: Record<string, unknown>, expectedVersion: number) {
  const working = await requireCmsWorkingCopy(tx, identity.id, true);
  assertCmsContentVersion(working, expectedVersion);
  if (identity.lockedAt || identity.deletedAt || identity.archivedAt) throw new HTTPException(409, { message: '内容已锁定、回收或归档' });
  const snapshot = buildCmsRevisionSnapshot({ ...working.snapshot, ...patch,
    ...(patch.body !== undefined ? { bodyDocument: normalizeCmsContentDocument(String(patch.body ?? ''), working.snapshot.bodyDocument ?? undefined) } : {}),
  });
  const frozen = await freezeCmsRevisionDependencies(tx, identity.siteId, snapshot.modelId, snapshot, { strict: false });
  const normalized = cmsContentRevisionSnapshotSchema.parse(frozen.snapshot);
  const [updated] = await tx.update(cmsContentWorkingCopies).set({ snapshot: normalized, editorialStatus: 'draft', version: sql`${cmsContentWorkingCopies.version} + 1` }).where(and(eq(cmsContentWorkingCopies.contentId, identity.id), eq(cmsContentWorkingCopies.version, expectedVersion))).returning();
  requireRow(updated, '内容已被其他人修改', 409);
  await syncCmsResourceRefs(tx, 'content', identity.id, identity.siteId, normalized);
  return updated;
}

export async function bindCmsReviewRevision(contentId: number, workflowInstanceId: number, revisionId: number): Promise<void> {
  const revision = await loadCmsRevision(db, revisionId);
  if (revision.contentId !== contentId) throw new HTTPException(409, { message: '审核修订归属不匹配' });
  await db.insert(cmsContentReviewRevisions).values({ contentId, workflowInstanceId, revisionId, hash: revision.hash }).onConflictDoNothing();
}

export async function getCmsReviewRevision(contentId: number, instanceId: number) {
  const [binding] = await db.select().from(cmsContentReviewRevisions).where(and(eq(cmsContentReviewRevisions.contentId, contentId), eq(cmsContentReviewRevisions.workflowInstanceId, instanceId))).limit(1);
  requireRow(binding, '该流程没有绑定内容修订', 409);
  const revision = await loadCmsRevision(db, binding.revisionId);
  if (revision.hash !== binding.hash) throw new HTTPException(409, { message: '审核修订摘要不一致' });
  return revision;
}

export async function approveCmsRevision(tx: DbTransaction, revisionId: number, workflowInstanceId?: number): Promise<void> {
  const revision = await loadCmsRevision(tx, revisionId);
  await tx.insert(cmsContentRevisionApprovals).values({ revisionId, hash: revision.hash, workflowInstanceId: workflowInstanceId ?? null }).onConflictDoNothing();
}
