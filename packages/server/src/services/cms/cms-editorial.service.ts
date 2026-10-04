import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { BodyOf } from '@zenith/shared/core';
import { cmsEditorialContract, cmsEditorialNoteSchema, cmsEditorialNoteReplySchema, cmsDocumentAnchorStatus, cmsTranslationContentKey, mergeCmsDistributionFields, validateCmsStructuredFields, type CmsQualityIssue, type CmsDocumentNode, type CmsBodyDocument } from '@zenith/shared/cms';
import { db, readSnapshot } from '../../db';
import { cmsContents, cmsContentWorkingCopies, cmsContentRevisions } from '../../db/schema';
import { cmsEditorialNotes, cmsEditorialNoteReplies, cmsDistributionSyncStates, cmsModelVersions } from '../../db/schema/cms-design';
import { requireCmsContentAccess } from './cms-content-access.service';
import { requireCmsWorkingCopy, writeCmsSystemWorkingCopy, assertCmsContentVersion, cmsRevisionHash, freezeCmsContentRevision } from './cms-content-revisions.service';
import { buildCmsContentListWhere } from './cms-contents-query.service';
import { cmsWallClockAt } from './cms-wall-clock';
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
import { getPgConstraintName, isPgUniqueViolation } from '../../lib/db-errors';
import { cmsWorkingHasUnpublishedChanges } from './cms-content-change-state';
import { currentUserId } from '../../lib/context';

async function mapNotes(rows: (typeof cmsEditorialNotes.$inferSelect)[], document: CmsBodyDocument | null) {
  const replies = rows.length ? await db.select().from(cmsEditorialNoteReplies).where(inArray(cmsEditorialNoteReplies.noteId, rows.map((row) => row.id))).orderBy(asc(cmsEditorialNoteReplies.id)) : [];
  const names = await resolveUserNames([...rows.flatMap((row) => [row.createdBy, row.resolvedBy]), ...replies.map((reply) => reply.createdBy)]);
  const mappedReplies = replies.map((reply) => pickEntity(cmsEditorialNoteReplySchema, reply, { createdByName: reply.createdBy ? names.get(reply.createdBy) ?? null : null }));
  return rows.map((row) => pickEntity(cmsEditorialNoteSchema, row, {
    createdByName: row.createdBy ? names.get(row.createdBy) ?? null : null,
    resolvedByName: row.resolvedBy ? names.get(row.resolvedBy) ?? null : null,
    anchorStatus: cmsDocumentAnchorStatus(document, row.anchor), replies: mappedReplies.filter((reply) => reply.noteId === row.id),
  }));
}

export async function listCmsEditorialNotes(id: number) {
  await requireCmsContentAccess(id);
  const rows = await db.select().from(cmsEditorialNotes).where(eq(cmsEditorialNotes.contentId, id)).orderBy(desc(cmsEditorialNotes.id));
  return mapNotes(rows, (await requireCmsWorkingCopy(db, id)).snapshot.bodyDocument);
}

export async function addCmsEditorialNote(id: number, input: BodyOf<typeof cmsEditorialContract.addNote>) {
  await requireCmsContentAccess(id);
  for (const userId of input.mentionedUserIds ?? []) await requireTenantUser(userId, '被提及用户不存在或已停用', { enabledOnly: true });
  const row = await db.transaction(async (tx) => {
    const working = await requireCmsWorkingCopy(tx, id, true);
    let target = working.snapshot;
    if (input.revisionId) {
      const [revision] = await tx.select().from(cmsContentRevisions).where(and(eq(cmsContentRevisions.id, input.revisionId), eq(cmsContentRevisions.contentId, id))).limit(1);
      target = requireRow(revision, '批注修订不属于当前内容').snapshot;
    } else if (input.anchor) assertCmsContentVersion(working, input.expectedVersion);
    if (input.anchor && cmsDocumentAnchorStatus(target.bodyDocument, input.anchor) !== 'current') throw new HTTPException(409, { message: '批注所选段落或引用文本已变化，请刷新后重新选择' });
    const { expectedVersion: _expectedVersion, ...values } = input;
    const [created] = await tx.insert(cmsEditorialNotes).values({ ...values, contentId: id }).returning();
    await notifyWithin(tx, 'cms.content.mentioned', {
      recipients: [...new Set(input.mentionedUserIds ?? [])].map((userId) => ({ type: 'user' as const, id: userId })),
      vars: { contentId: id, noteId: created.id }, dedupeKey: `cms:note:${created.id}`, link: `/cms/contents/edit?id=${id}${input.anchor ? `&field=body&block=${encodeURIComponent(input.anchor.nodeId)}` : input.fieldPath ? `&field=${encodeURIComponent(input.fieldPath)}` : ''}`,
    });
    return created;
  });
  return (await mapNotes([row], (await requireCmsWorkingCopy(db, id)).snapshot.bodyDocument))[0];
}

export async function resolveCmsEditorialNote(id: number, noteId: number, input: BodyOf<typeof cmsEditorialContract.resolveNote>) {
  await requireCmsContentAccess(id);
  const [row] = await db.update(cmsEditorialNotes).set({ resolved: input.resolved, resolvedBy: input.resolved ? currentUserId() : null, resolvedAt: input.resolved ? new Date() : null }).where(and(eq(cmsEditorialNotes.id, noteId), eq(cmsEditorialNotes.contentId, id))).returning();
  return (await mapNotes([requireRow(row, '批注不存在')], (await requireCmsWorkingCopy(db, id)).snapshot.bodyDocument))[0];
}

export async function replyCmsEditorialNote(id: number, noteId: number, input: BodyOf<typeof cmsEditorialContract.replyNote>) {
  await requireCmsContentAccess(id);
  for (const userId of input.mentionedUserIds ?? []) await requireTenantUser(userId, '被提及用户不存在或已停用', { enabledOnly: true });
  const reply = await db.transaction(async (tx) => {
    const [found] = await tx.select().from(cmsEditorialNotes).where(and(eq(cmsEditorialNotes.id, noteId), eq(cmsEditorialNotes.contentId, id))).for('update').limit(1);
    const note = requireRow(found, '批注不存在');
    if (note.resolved) throw new HTTPException(409, { message: '请先重新打开批注会话，再添加回复' });
    const [created] = await tx.insert(cmsEditorialNoteReplies).values({ ...input, noteId }).returning();
    await notifyWithin(tx, 'cms.content.mentioned', {
      recipients: [...new Set(input.mentionedUserIds ?? [])].map((userId) => ({ type: 'user' as const, id: userId })),
      vars: { contentId: id, noteId }, dedupeKey: `cms:note-reply:${created.id}`, link: `/cms/contents/edit?id=${id}${note.anchor ? `&field=body&block=${encodeURIComponent(note.anchor.nodeId)}` : ''}`,
    });
    return created;
  });
  const names = await resolveUserNames([reply.createdBy]);
  return pickEntity(cmsEditorialNoteReplySchema, reply, { createdByName: reply.createdBy ? names.get(reply.createdBy) ?? null : null });
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
  if (sourceId !== id) await requireCmsContentAccess(sourceId);
  const scope = await buildCmsContentListWhere({ siteId: content.siteId });
  return readSnapshot(async (tx) => {
    const source = await requireCmsWorkingCopy(tx, sourceId);
    const rows = await tx.select({ id: cmsContents.id, status: cmsContents.status,
      title: sql<string>`${cmsContentWorkingCopies.snapshot}->>'title'`,
      locale: sql<string>`${cmsContentWorkingCopies.snapshot}->>'locale'`,
      sourceRevisionId: sql<number | null>`(${cmsContentWorkingCopies.snapshot}->>'sourceRevisionId')::integer`,
    }).from(cmsContents).innerJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsContents.id))
      .where(buildWhere(scope, or(eq(cmsContents.id, sourceId), sql`(${cmsContentWorkingCopies.snapshot}->>'translationOfId')::integer = ${sourceId}`)));
    const baselineIds = [...new Set(rows.flatMap((row) => row.id !== sourceId && row.sourceRevisionId ? [row.sourceRevisionId] : []))];
    const baselines = baselineIds.length ? await tx.select({ id: cmsContentRevisions.id, snapshot: cmsContentRevisions.snapshot, hash: cmsContentRevisions.hash })
      .from(cmsContentRevisions).where(and(eq(cmsContentRevisions.contentId, sourceId), inArray(cmsContentRevisions.id, baselineIds))) : [];
    for (const revision of baselines) {
      if (cmsRevisionHash(revision.snapshot) !== revision.hash) throw new HTTPException(409, { message: '翻译来源修订完整性校验失败' });
    }
    const modelVersionIds = [...new Set([source.snapshot, ...baselines.map((revision) => revision.snapshot)].flatMap((snapshot) => snapshot.modelVersionId ? [snapshot.modelVersionId] : []))];
    const models = modelVersionIds.length ? await tx.select({ id: cmsModelVersions.id, fields: cmsModelVersions.fields }).from(cmsModelVersions).where(inArray(cmsModelVersions.id, modelVersionIds)) : [];
    const fieldsByVersion = new Map(models.map((model) => [model.id, model.fields]));
    const sourceKey = cmsTranslationContentKey(source.snapshot, fieldsByVersion.get(source.snapshot.modelVersionId ?? 0));
    const baselineKeys = new Map(baselines.map((revision) => [revision.id, cmsTranslationContentKey(revision.snapshot, fieldsByVersion.get(revision.snapshot.modelVersionId ?? 0))]));
    return rows.map((row) => ({ ...row, sourceChanged: row.id !== sourceId && baselineKeys.get(row.sourceRevisionId ?? 0) !== sourceKey }));
  });
}

export async function createCmsTranslation(id: number, input: BodyOf<typeof cmsEditorialContract.createTranslation>) {
  await requireCmsContentAccess(id);
  const current = await requireCmsWorkingCopy(db, id);
  const sourceId = current.snapshot.translationOfId ?? id;
  const source = await requireCmsContentAccess(sourceId);
  const revision = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, source.siteId);
    const [identity] = await tx.select().from(cmsContents).where(eq(cmsContents.id, sourceId)).for('update').limit(1);
    requireRow(identity, '翻译来源内容不存在');
    const working = await requireCmsWorkingCopy(tx, sourceId, true);
    const [existing] = await tx.select({ id: cmsContentWorkingCopies.contentId }).from(cmsContentWorkingCopies).where(and(
      sql`(${cmsContentWorkingCopies.snapshot}->>'translationOfId')::integer = ${sourceId}`,
      sql`${cmsContentWorkingCopies.snapshot}->>'locale' = ${input.locale}`,
    )).limit(1);
    if (existing || working.snapshot.locale === input.locale) throw new HTTPException(409, { message: '该语言的内容变体已存在' });
    return freezeCmsContentRevision(tx, identity, working, 'checkpoint', `冻结 ${input.locale} 翻译来源`);
  });
  // The source transaction has committed: creation must not open a second connection while holding its site lock.
  try {
    const created = await createCmsContent({ ...revision.snapshot, ...input, siteId: source.siteId, translationOfId: sourceId, sourceRevisionId: revision.id,
      slug: null, staticPath: null, scheduledAt: null, expireAt: null }, { fromRevisionId: revision.id });
    return { id: created.id };
  } catch (error) {
    if (isPgUniqueViolation(error) && getPgConstraintName(error) === 'cms_working_translation_locale_uq') throw new HTTPException(409, { message: '该语言的内容变体已存在' });
    throw error;
  }
}

export async function getCmsEditorialMetrics(siteId: number) {
  const where = await buildCmsContentListWhere({ siteId });
  return readSnapshot(async (tx) => {
  const [row] = await tx.select({
    total: sql<number>`count(*)::integer`,
    working: sql<number>`count(*) filter (where ${cmsContentWorkingCopies.editorialStatus} = 'draft')::integer`,
    pending: sql<number>`count(*) filter (where ${cmsContentWorkingCopies.editorialStatus} = 'pending')::integer`,
    overdue: sql<number>`count(*) filter (where ${cmsWallClockAt(sql`${cmsContentWorkingCopies.snapshot}->>'dueAt'`)} < now() and ${cmsContentWorkingCopies.editorialStatus} != 'clean')::integer`,
    scheduled: sql<number>`count(*) filter (where ${cmsWallClockAt(sql`${cmsContentWorkingCopies.snapshot}->>'scheduledAt'`)} > now())::integer`,
    unpublishedChanges: sql<number>`count(*) filter (where ${cmsWorkingHasUnpublishedChanges()})::integer`,
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
