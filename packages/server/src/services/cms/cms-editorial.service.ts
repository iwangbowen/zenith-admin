import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BodyOf } from '@zenith/shared/core';
import { cmsEditorialContract, cmsEditorialNoteSchema, mergeCmsDistributionFields, validateCmsStructuredFields, type CmsQualityIssue, type CmsDocumentNode } from '@zenith/shared/cms';
import { db, readSnapshot } from '../../db';
import { cmsContents, cmsContentWorkingCopies, cmsContentRevisions } from '../../db/schema';
import { cmsEditorialNotes, cmsDistributionSyncStates, cmsModelVersions } from '../../db/schema/cms-design';
import { requireCmsContentAccess } from './cms-content-access.service';
import { requireCmsWorkingCopy, writeCmsSystemWorkingCopy, assertCmsContentVersion } from './cms-content-revisions.service';
import { buildCmsContentListWhere } from './cms-contents-query.service';
import { createCmsContent } from './cms-contents-write.service';
import { pickEntity } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { resolveUserNames, requireTenantUser } from '../../lib/user-nicknames';
import { buildWhere } from '../../lib/where-helpers';
import { parseDateTimeInput } from '../../lib/datetime';
import { freezeCmsRevisionDependencies } from './cms-revision-dependencies.service';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { getCmsModel } from './cms-models.service';

async function mapNotes(rows: (typeof cmsEditorialNotes.$inferSelect)[]) {
  const names = await resolveUserNames(rows.flatMap((row) => row.createdBy ? [row.createdBy] : []));
  return rows.map((row) => pickEntity(cmsEditorialNoteSchema, row, { createdByName: row.createdBy ? names.get(row.createdBy) ?? null : null }));
}

export async function listCmsEditorialNotes(id: number) {
  await requireCmsContentAccess(id);
  const rows = await db.select().from(cmsEditorialNotes).where(eq(cmsEditorialNotes.contentId, id)).orderBy(desc(cmsEditorialNotes.id));
  return mapNotes(rows);
}

export async function addCmsEditorialNote(id: number, input: BodyOf<typeof cmsEditorialContract.addNote>) {
  await requireCmsContentAccess(id);
  if (input.revisionId) {
    const [revision] = await db.select({ id: cmsContentRevisions.id }).from(cmsContentRevisions).where(and(eq(cmsContentRevisions.id, input.revisionId), eq(cmsContentRevisions.contentId, id))).limit(1);
    requireRow(revision, '批注修订不属于当前内容');
  }
  for (const userId of input.mentionedUserIds ?? []) await requireTenantUser(userId, '被提及用户不存在或已停用', { enabledOnly: true });
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(cmsEditorialNotes).values({ ...input, contentId: id }).returning();
    await notifyWithin(tx, 'cms.content.mentioned', {
      recipients: [...new Set(input.mentionedUserIds ?? [])].map((userId) => ({ type: 'user' as const, id: userId })),
      vars: { contentId: id, noteId: created.id }, dedupeKey: `cms:note:${created.id}`, link: `/cms/contents/edit?id=${id}`,
    });
    return created;
  });
  return (await mapNotes([row]))[0];
}

export async function resolveCmsEditorialNote(id: number, noteId: number, input: BodyOf<typeof cmsEditorialContract.resolveNote>) {
  await requireCmsContentAccess(id);
  const [row] = await db.update(cmsEditorialNotes).set({ resolved: input.resolved }).where(and(eq(cmsEditorialNotes.id, noteId), eq(cmsEditorialNotes.contentId, id))).returning();
  return (await mapNotes([requireRow(row, '批注不存在')]))[0];
}

export async function checkCmsWorkingQuality(id: number) {
  const content = await requireCmsContentAccess(id);
  const working = await requireCmsWorkingCopy(db, id);
  const snapshot = working.snapshot;
  const issues: CmsQualityIssue[] = [];
  const warn = (rule: string, fieldPath: string, message: string) => issues.push({ rule, fieldPath, message, severity: 'warning' });
  // Dependency validation uses a rollback-only transaction: GET does not create binary versions.
  if (!snapshot.title.trim() || snapshot.title === '未命名内容') issues.push({ rule: 'title', fieldPath: 'title', message: '请填写正式标题', severity: 'error' });
  if (!snapshot.summary?.trim()) warn('summary', 'summary', '建议填写摘要，便于检索和分享');
  if (!snapshot.coverImage) warn('cover', 'coverImage', '尚未选择封面');
  if (!snapshot.seoTitle) warn('seo', 'seoTitle', '未设置独立 SEO 标题，将使用内容标题');
  const checkNode = (node: CmsDocumentNode) => {
    if (node.kind !== 'element') return;
    if (node.tag === 'img' && !node.attributes.alt?.trim()) warn('accessibility', `body.${node.id}`, '图片缺少替代文本');
    node.children.forEach(checkNode);
  };
  snapshot.bodyDocument?.nodes.forEach(checkNode);
  const scheduled = parseDateTimeInput(snapshot.scheduledAt);
  const expire = parseDateTimeInput(snapshot.expireAt);
  if (scheduled && expire && expire <= scheduled) issues.push({ rule: 'schedule', fieldPath: 'expireAt', message: '到期时间必须晚于发布时间', severity: 'error' });
  const rollback = Symbol('quality-read');
  try {
    await db.transaction(async (tx) => {
      await freezeCmsRevisionDependencies(tx, content.siteId, snapshot.modelId, snapshot, { strict: true });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      if (!(error instanceof HTTPException)) throw error;
      issues.push({ rule: 'dependencies', fieldPath: 'extend', message: error.message, severity: 'error' });
    }
  }
  return { version: working.version, issues };
}

export async function listCmsTranslations(id: number) {
  const content = await requireCmsContentAccess(id);
  const current = await requireCmsWorkingCopy(db, id);
  const sourceId = current.snapshot.translationOfId ?? content.id;
  const scope = await buildCmsContentListWhere({ siteId: content.siteId });
  const rows = await db.select({ id: cmsContents.id, status: cmsContents.status, snapshot: sql<typeof cmsContentWorkingCopies.$inferSelect['snapshot']>`${cmsContentWorkingCopies.snapshot} - 'body' - 'bodyDocument'` })
    .from(cmsContents).innerJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsContents.id))
    .where(buildWhere(scope, or(eq(cmsContents.id, sourceId), sql`(${cmsContentWorkingCopies.snapshot}->>'translationOfId')::integer = ${sourceId}`)));
  const [latest] = await db.select({ id: cmsContentRevisions.id }).from(cmsContentRevisions).where(eq(cmsContentRevisions.contentId, sourceId)).orderBy(desc(cmsContentRevisions.id)).limit(1);
  return rows.map((row) => ({ id: row.id, title: row.snapshot.title, locale: row.snapshot.locale, status: row.status,
    sourceRevisionId: row.snapshot.sourceRevisionId ?? null, sourceChanged: row.id !== sourceId && Boolean(latest && latest.id !== row.snapshot.sourceRevisionId) }));
}

export async function createCmsTranslation(id: number, input: BodyOf<typeof cmsEditorialContract.createTranslation>) {
  await requireCmsContentAccess(id);
  const current = await requireCmsWorkingCopy(db, id);
  const sourceId = current.snapshot.translationOfId ?? id;
  const source = await requireCmsContentAccess(sourceId);
  const working = await requireCmsWorkingCopy(db, sourceId);
  const [existing] = await db.select({ id: cmsContentWorkingCopies.contentId }).from(cmsContentWorkingCopies).where(and(
    sql`(${cmsContentWorkingCopies.snapshot}->>'translationOfId')::integer = ${sourceId}`,
    sql`${cmsContentWorkingCopies.snapshot}->>'locale' = ${input.locale}`,
  )).limit(1);
  if (existing || working.snapshot.locale === input.locale) throw new HTTPException(409, { message: '该语言的内容变体已存在' });
  const [revision] = await db.select({ id: cmsContentRevisions.id }).from(cmsContentRevisions).where(eq(cmsContentRevisions.contentId, sourceId)).orderBy(desc(cmsContentRevisions.id)).limit(1);
  const { bodyDocument: _document, assetVersions: _assets, modelVersionId: _modelVersion, ...fields } = working.snapshot;
  const created = await createCmsContent({ ...fields, ...input, siteId: source.siteId, translationOfId: sourceId, sourceRevisionId: revision?.id ?? null,
    slug: null, staticPath: null, scheduledAt: null, expireAt: null, tagIds: [...working.snapshot.tagIds] });
  return { id: created.id };
}

export async function getCmsEditorialMetrics(siteId: number) {
  const where = await buildCmsContentListWhere({ siteId });
  return readSnapshot(async (tx) => {
  const [row] = await tx.select({
    total: sql<number>`count(*)::integer`,
    working: sql<number>`count(*) filter (where ${cmsContentWorkingCopies.editorialStatus} = 'draft')::integer`,
    pending: sql<number>`count(*) filter (where ${cmsContentWorkingCopies.editorialStatus} = 'pending')::integer`,
    overdue: sql<number>`count(*) filter (where (${cmsContentWorkingCopies.snapshot}->>'dueAt')::timestamp < now() and ${cmsContentWorkingCopies.editorialStatus} != 'clean')::integer`,
    scheduled: sql<number>`count(*) filter (where (${cmsContentWorkingCopies.snapshot}->>'scheduledAt')::timestamp > now())::integer`,
    unpublishedChanges: sql<number>`count(*) filter (where ${cmsContentWorkingCopies.editorialStatus} != 'clean')::integer`,
  }).from(cmsContents).innerJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsContents.id)).where(where);
  const unresolvedNotes = await tx.$count(cmsEditorialNotes, and(eq(cmsEditorialNotes.resolved, false), inArray(cmsEditorialNotes.contentId, tx.select({ id: cmsContents.id }).from(cmsContents).where(where))));
  return { ...row, unresolvedNotes };
  });
}

export async function getCmsDistributionConflict(id: number) {
  await requireCmsContentAccess(id);
  const working = await requireCmsWorkingCopy(db, id);
  const [state] = await db.select().from(cmsDistributionSyncStates).where(eq(cmsDistributionSyncStates.contentId, id)).limit(1);
  if (!state?.pending) return null;
  return { version: working.version, sourceVersion: state.pending.sourceVersion, targetOwnedFields: state.targetOwnedFields,
    conflicts: mergeCmsDistributionFields(state.baseline, working.snapshot, state.pending.incoming, state.targetOwnedFields).conflicts };
}

export async function resolveCmsDistributionConflict(id: number, input: BodyOf<typeof cmsEditorialContract.resolveDistribution>) {
  const content = await requireCmsContentAccess(id);
  return db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, content.siteId);
    const working = await requireCmsWorkingCopy(tx, id, true);
    assertCmsContentVersion(working, input.expectedVersion);
    const [state] = await tx.select().from(cmsDistributionSyncStates).where(eq(cmsDistributionSyncStates.contentId, id)).for('update').limit(1);
    if (!state?.pending) throw new HTTPException(409, { message: '没有待处理的分发差异' });
    const merge = mergeCmsDistributionFields(state.baseline, working.snapshot, state.pending.incoming, state.targetOwnedFields);
    const targetOwned = new Set(state.targetOwnedFields);
    for (const conflict of merge.conflicts) {
      const choice = input.choices[conflict.field];
      if (!choice) throw new HTTPException(400, { message: `请选择字段「${conflict.field}」的保留值` });
      if (choice === 'source') { merge.patch[conflict.field] = conflict.incoming; targetOwned.delete(conflict.field); }
      else targetOwned.add(conflict.field);
    }
    const updated = await writeCmsSystemWorkingCopy(tx, content, merge.patch, input.expectedVersion);
    await tx.update(cmsDistributionSyncStates).set({ baseline: state.pending.incoming, sourceVersion: state.pending.sourceVersion, targetOwnedFields: [...targetOwned], pending: null }).where(eq(cmsDistributionSyncStates.contentId, id));
    await tx.update(cmsContents).set({ distributionSourceVersion: state.pending.sourceVersion }).where(eq(cmsContents.id, id));
    return { version: updated.version };
  });
}

export async function previewCmsTypeConversion(id: number, input: BodyOf<typeof cmsEditorialContract.previewConversion>) {
  const content = await requireCmsContentAccess(id);
  const working = await requireCmsWorkingCopy(db, id);
  const model = await getCmsModel(input.modelId, content.siteId);
  const modelVersionId = input.modelVersionId ?? model.publishedVersionId;
  if (!modelVersionId || model.status !== 'enabled') throw new HTTPException(400, { message: '请选择已发布且启用的模型' });
  const [version] = await db.select().from(cmsModelVersions).where(and(eq(cmsModelVersions.id, modelVersionId), eq(cmsModelVersions.modelId, input.modelId))).limit(1);
  requireRow(version, '目标模型版本不存在');
  const values: Record<string, unknown> = {};
  const used = new Set<string>();
  for (const field of version.fields) {
    const from = input.fieldMapping?.[field.name] ?? field.name;
    if (working.snapshot.extend?.[from] !== undefined) { values[field.name] = working.snapshot.extend[from]; used.add(from); }
  }
  return { version: working.version, modelVersionId, values, droppedFields: Object.keys(working.snapshot.extend ?? {}).filter((field) => !used.has(field)),
    issues: validateCmsStructuredFields(version.fields, values, false) };
}

export async function convertCmsContentType(id: number, input: BodyOf<typeof cmsEditorialContract.convertType>) {
  const content = await requireCmsContentAccess(id);
  const preview = await previewCmsTypeConversion(id, input);
  if (preview.issues.length) throw new HTTPException(400, { message: preview.issues.map((issue) => issue.message).join('；') });
  if (preview.droppedFields.length && !input.acknowledgeLoss) throw new HTTPException(400, { message: '请确认转换会移除未映射的扩展字段' });
  return db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, content.siteId);
    const updated = await writeCmsSystemWorkingCopy(tx, content, { modelId: input.modelId, modelVersionId: preview.modelVersionId, extend: preview.values }, input.expectedVersion);
    return { version: updated.version };
  });
}
