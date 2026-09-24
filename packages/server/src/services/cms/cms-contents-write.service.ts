import { requireTenantUser } from '../../lib/user-nicknames';
import { requireRow } from '../../lib/db-assert';
import { eq, and, inArray, isNull, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContents, cmsTags, cmsPages, cmsContentWorkingCopies, users } from '../../db/schema';
import type { CmsContentRow, CmsSiteRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { parseDateTimeInput } from '../../lib/datetime';
import { buildWhere } from '../../lib/where-helpers';
import { assertCmsModelUsableBySite } from './cms-models.service';
import { assertChannelAccess, assertChannelsAccess } from './cms-channels.service';
import { logContentOp } from './cms-content-op-logs.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { currentUserOrNull, hasPermission } from '../../lib/context';
import { isWorkflowAuditEnabled, startCmsContentWorkflow, assertNoActiveContentWorkflow } from './cms-workflow.service';
import { enqueueCmsWebhookEvents, insertCmsContentWebhookOutbox } from './cms-webhook.service';
import { assertContentTemplateBySite } from './cms-template-refs.service';
import type { CmsContentAttachment, CmsSiteOpsSettings, CreateCmsContentInput, UpdateCmsContentInput, CmsContentStatus } from '@zenith/shared/cms';
import { buildCmsEntityLink, isCmsEntityLink, createCmsContentSchema, updateCmsContentSchema } from '@zenith/shared/cms';
import { ensureCmsLinkTargetExists } from './cms-link.service';
import { extractFirstImage, normalizeAttachments } from './cms-body.service';
import { resolveCmsSiteOpsSettings } from './cms-site-settings';
import { sanitizeUserText } from './cms-sensitive-words.service';
import { replaceErrorProneWords } from './cms-error-prone-words.service';
import { assertCompleteCmsBatch } from './cms-access';
import { canTransitionCmsContentStatus } from './cms-content-state';
import { requireCmsScheduledAtMutationPermission } from './cms-publish-permission';
import { assertCmsContentUnlocked, assertNoLockedCmsMappedCopies } from './cms-content-lock.service';
import { lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import { canonicalizeCmsResourceFields, syncCmsResourceRefs } from './cms-resource-refs.service';
import { enqueueCmsPublishOutboxes } from './cms-publish-outbox.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { assertCmsWidgetSourcesMutable } from './cms-widgets.service';
import { insertContentPublishOutbox, ensureChannelForContent } from './cms-contents-internal';
import { ensureCmsContentExists, getCmsContent } from './cms-contents-query.service';
import { applyCmsModelFieldDefaults, validateCmsModelExtend } from './cms-model-extend';
import { sanitizeCmsHtml } from './cms-html-sanitizer';
import { requireCmsContentAccess, requireCmsContentsAccess } from './cms-content-access.service';
import { approveCmsRevision, assertCmsContentVersion, bindCmsReviewRevision, buildCmsRevisionSnapshot, cmsRevisionToContentRow, freezeCmsContentRevision, initializeCmsContentWorkingCopy, loadCmsRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { normalizeCmsContentDocument, renderCmsContentDocument } from './cms-document.service';
import { refreshCmsContentResourcePins } from './cms-content-resource-selection';

// ─── 写入辅助 ─────────────────────────────────────────────────────────────────

/** 模型 searchable 字段的 extend 文本值（纳入全文索引） */
export async function ensureCmsContentTargetAccess(siteId: number, channelId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  await assertChannelAccess(channelId);
  const channel = await ensureChannelForContent(siteId, channelId);
  return { channel };
}

/** 发布前按内容形态校验必要数据（草稿允许不完整，发布必须齐备） */
function assertContentTypeReady(row: CmsContentRow): void {
  const media = (row.mediaData ?? {}) as { images?: unknown[]; mediaUrl?: string };
  if (row.contentType === 'link' && !row.externalLink?.trim()) {
    throw new HTTPException(400, { message: '外链型内容须填写外链地址后才能发布' });
  }
  if (row.contentType === 'album' && (!Array.isArray(media.images) || media.images.length === 0)) {
    throw new HTTPException(400, { message: '图集内容须至少添加一张图片后才能发布' });
  }
  if (row.contentType === 'media' && !media.mediaUrl?.trim()) {
    throw new HTTPException(400, { message: '音视频内容须填写媒体地址后才能发布' });
  }
}

async function assertContentStaticPathFree(
  executor: DbExecutor,
  siteId: number,
  staticPath: string | null | undefined,
): Promise<void> {
  if (!staticPath) return;
  const [page] = await executor.select({ id: cmsPages.id, name: cmsPages.name }).from(cmsPages)
    .where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.path, staticPath))).limit(1);
  if (page) throw new HTTPException(400, { message: `静态路径已被页面「${page.name}」（#${page.id}）占用` });
}

async function assertRelatedContentAccess(siteId: number, relatedIds: number[]): Promise<void> {
  const targets = [...new Set(relatedIds)];
  if (targets.length === 0) return;
  const rows = await db.select({ id: cmsContents.id, channelId: cmsContents.channelId })
    .from(cmsContents)
    .where(and(
      eq(cmsContents.siteId, siteId),
      inArray(cmsContents.id, targets),
      isNull(cmsContents.deletedAt),
    ));
  assertCompleteCmsBatch(targets, rows.map((row) => row.id), '相关文章');
  await requireCmsContentsAccess(targets);
}

// ─── 属性自动标记（P4：保存时按正文/形态数据/封面检测含图/含视频/含附件）──────────
const ATTACHMENT_LINK_RE = /<a\b[^>]*href="[^"]*\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv)(?:[?#][^"]*)?"/i;

export function detectContentFlags(input: {
  contentType: string;
  body: string | null | undefined;
  mediaData: Record<string, unknown> | null | undefined;
  coverImage: string | null | undefined;
  attachments?: readonly CmsContentAttachment[] | null;
}): { hasImage: boolean; hasVideo: boolean; hasAttachment: boolean } {
  const body = input.body ?? '';
  const media = input.mediaData ?? {};
  const albumImages = Array.isArray((media as { images?: unknown[] }).images) ? (media as { images: unknown[] }).images : [];
  const hasImage = Boolean(input.coverImage)
    || /<img\b/i.test(body)
    || (input.contentType === 'album' && albumImages.length > 0);
  const hasVideo = /<video\b|<iframe\b[^>]*(?:youtube|bilibili|qq\.com\/txp)/i.test(body)
    || (input.contentType === 'media' && (media as { mediaType?: string }).mediaType === 'video');
  const hasAttachment = (input.attachments?.length ?? 0) > 0
    || ATTACHMENT_LINK_RE.test(body)
    || /<a\b[^>]*href="[^"]*\/api\/files\//i.test(body);
  return { hasImage, hasVideo, hasAttachment };
}

// ─── 站点内容策略（保存管线：词库自动替换 + 正文首图自动封面）────────────────────

/** 站点开关关闭时直接返回原文，避免无谓的词库加载 */
async function applyWordPolicies(
  text: string | null | undefined,
  ops: CmsSiteOpsSettings,
): Promise<string | null | undefined> {
  if (text == null || text === '') return text;
  let out = text;
  if (ops.autoReplaceSensitiveWords) out = await sanitizeUserText(out);
  if (ops.autoReplaceErrorProneWords) out = await replaceErrorProneWords(out);
  return out;
}

interface CmsContentPolicyInput {
  title?: string;
  summary?: string | null;
  body?: string | null;
  coverImage?: string | null;
  attachments?: CmsContentAttachment[];
}

/**
 * 内容保存前的站点策略处理（创建与更新共用）：
 * 1. 按站点开关对标题/摘要/正文执行敏感词与易错词自动替换（敏感词拦截词仍抛 400）；
 * 2. 附件列表规范化（去空 / 补扩展名 / 重排序号）；
 * 3. 未填封面且开启自动封面时，提取正文首图回填。
 * 仅处理本次提交中出现的字段，未提交字段保持 undefined 以免误覆盖。
 */
export async function applyCmsContentPolicies<T extends CmsContentPolicyInput>(
  input: T,
  site: Pick<CmsSiteRow, 'settings'>,
  fallback: { body?: string | null; coverImage?: string | null } = {},
): Promise<T> {
  const ops = resolveCmsSiteOpsSettings(site.settings);
  const out: T = { ...input };

  if (out.title !== undefined) out.title = (await applyWordPolicies(out.title, ops)) as string;
  if (out.summary !== undefined) out.summary = (await applyWordPolicies(out.summary, ops)) ?? null;
  if (out.body !== undefined) {
    // Normalize HTML before applying text policies, then sanitize again because
    // policy replacements operate on strings and must never be able to re-open
    // an HTML attribute/tag boundary.
    if (out.body === null) {
      out.body = null;
    } else {
      const safeBody = sanitizeCmsHtml(out.body);
      out.body = sanitizeCmsHtml((await applyWordPolicies(safeBody, ops)) ?? '');
    }
  }
  if (out.attachments !== undefined) out.attachments = normalizeAttachments(out.attachments);

  if (ops.autoCoverFromBody) {
    const effectiveCover = out.coverImage !== undefined ? out.coverImage : fallback.coverImage;
    if (!effectiveCover?.trim()) {
      const effectiveBody = out.body !== undefined ? out.body : fallback.body;
      const firstImage = extractFirstImage(effectiveBody);
      if (firstImage) out.coverImage = firstImage;
    }
  }
  return out;
}

/** New content starts as a non-public identity plus an independently editable working copy. */
export async function createCmsContent(input: CreateCmsContentInput) {
  const data = createCmsContentSchema.parse(input);
  const site = await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  await assertChannelAccess(data.channelId);
  const channel = await ensureChannelForContent(data.siteId, data.channelId);
  const modelId = data.modelId === undefined ? channel.modelId : data.modelId;
  if (modelId) await assertCmsModelUsableBySite(modelId, data.siteId);
  await assertContentTemplateBySite(data.siteId, data.detailTemplate);
  await assertChannelsAccess(data.extraChannelIds ?? []);
  await assertRelatedContentAccess(data.siteId, data.relatedIds ?? []);
  await ensureCmsLinkTargetExists(data.siteId, data.externalLink);
  await requireCmsScheduledAtMutationPermission({ current: null, requested: parseDateTimeInput(data.scheduledAt) });
  if (data.ownerId) await requireTenantUser(data.ownerId, '内容负责人不存在或已停用', { enabledOnly: true });
  if (data.translationOfId) {
    const source = await requireCmsContentAccess(data.translationOfId);
    if (source.siteId !== data.siteId) throw new HTTPException(400, { message: '翻译来源必须属于同一站点' });
  }
  if (data.sourceRevisionId) {
    const source = await loadCmsRevision(db, data.sourceRevisionId);
    await requireCmsContentAccess(source.contentId);
    if (source.siteId !== data.siteId || (data.translationOfId && source.contentId !== data.translationOfId)) throw new HTTPException(400, { message: '来源修订不属于所选来源内容或站点' });
  }
  const prepared = await applyCmsContentPolicies({ ...data, ...(data.bodyDocument ? { body: renderCmsContentDocument(data.bodyDocument) } : {}) }, site);
  prepared.extend = await applyCmsModelFieldDefaults(modelId, prepared.extend ?? {});
  await validateCmsModelExtend(modelId, prepared.extend, 'draft');
  const creator = currentUserOrNull();
  const owner = creator ? await db.query.users.findFirst({ where: eq(users.id, creator.userId), columns: { departmentId: true } }) : null;
  const created = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, data.siteId);
    await assertContentStaticPathFree(tx, data.siteId, prepared.staticPath);
    const canonical = await canonicalizeCmsResourceFields(tx, data.siteId, prepared, 'content');
    const snapshot = buildCmsRevisionSnapshot({ ...canonical, modelId: modelId ?? null, bodyDocument: normalizeCmsContentDocument(canonical.body ?? '', data.bodyDocument ?? undefined) });
    const [identity] = await tx.insert(cmsContents).values({ siteId: data.siteId, channelId: data.channelId, modelId: modelId ?? null, title: data.title, contentType: data.contentType ?? 'article', deptId: owner?.departmentId ?? null, status: 'draft' }).returning();
    requireRow(identity, '内容创建失败');
    const working = await initializeCmsContentWorkingCopy(tx, identity, snapshot);
    await freezeCmsContentRevision(tx, identity, working, 'checkpoint', '初始工作稿');
    await syncCmsResourceRefs(tx, 'content', identity.id, identity.siteId, snapshot);
    await logContentOp(tx, identity.id, 'created');
    return identity;
  });
  return getCmsContent(created.id);
}

export async function updateCmsContent(id: number, input: UpdateCmsContentInput, options?: { suppressDistributionSideEffects?: boolean; skipAccessCheck?: boolean }) {
  const data = updateCmsContentSchema.parse(input);
  const identity = options?.skipAccessCheck ? await ensureCmsContentExists(id) : await requireCmsContentAccess(id);
  assertCmsContentUnlocked(identity);
  if (identity.deletedAt || identity.archivedAt) throw new HTTPException(409, { message: '回收站或已归档内容不可编辑' });
  const site = await ensureCmsSiteExists(identity.siteId);
  const { expectedVersion, saveMode = 'manual', refreshResourceIds = [], ...patch } = data;
  if (refreshResourceIds.length && !await hasPermission('cms:resource:list')) throw new HTTPException(403, { message: '重新选择素材需要本站素材查看权限' });
  if (patch.ownerId) await requireTenantUser(patch.ownerId, '内容负责人不存在或已停用', { enabledOnly: true });
  if (patch.translationOfId) {
    const source = await requireCmsContentAccess(patch.translationOfId);
    if (source.siteId !== identity.siteId || source.id === id) throw new HTTPException(400, { message: '翻译来源必须是本站其他内容' });
  }
  if (patch.sourceRevisionId) {
    const source = await loadCmsRevision(db, patch.sourceRevisionId);
    await requireCmsContentAccess(source.contentId);
    if (source.siteId !== identity.siteId || (patch.translationOfId && source.contentId !== patch.translationOfId)) throw new HTTPException(400, { message: '来源修订不属于所选来源内容或站点' });
  }
  if (patch.bodyDocument) patch.body = renderCmsContentDocument(patch.bodyDocument);
  if (patch.channelId) {
    if (!options?.skipAccessCheck) await assertChannelAccess(patch.channelId);
    await ensureChannelForContent(identity.siteId, patch.channelId);
  }
  if (!options?.skipAccessCheck) {
    if (patch.extraChannelIds) await assertChannelsAccess(patch.extraChannelIds);
    if (patch.relatedIds) await assertRelatedContentAccess(identity.siteId, patch.relatedIds);
  }
  if (patch.externalLink !== undefined) await ensureCmsLinkTargetExists(identity.siteId, patch.externalLink);
  if (isCmsEntityLink(patch.externalLink) && patch.externalLink === buildCmsEntityLink('content', id)) throw new HTTPException(400, { message: '内部链接不能指向内容自身' });
  const before = await requireCmsWorkingCopy(db, id);
  if (patch.modelId !== undefined && patch.modelId !== before.snapshot.modelId) throw new HTTPException(400, { message: '内容类型不可直接更换，请使用类型转换' });
  assertCmsContentVersion(before, expectedVersion);
  await requireCmsScheduledAtMutationPermission({ current: parseDateTimeInput(before.snapshot.scheduledAt), requested: patch.scheduledAt === undefined ? undefined : parseDateTimeInput(patch.scheduledAt) });
  const policied = await applyCmsContentPolicies(patch, site, { body: before.snapshot.body, coverImage: before.snapshot.coverImage });
  await validateCmsModelExtend(before.snapshot.modelId, policied.extend ?? before.snapshot.extend, 'draft', before.snapshot.modelVersionId);
  await assertContentTemplateBySite(identity.siteId, policied.detailTemplate === undefined ? before.snapshot.detailTemplate : policied.detailTemplate);
  await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, identity.siteId);
    const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    requireRow(locked, '内容不存在');
    assertCmsContentUnlocked(locked);
    const working = await requireCmsWorkingCopy(tx, id, true);
    assertCmsContentVersion(working, expectedVersion);
    const canonical = await canonicalizeCmsResourceFields(tx, identity.siteId, policied, 'content');
    const assetVersions = await refreshCmsContentResourcePins(tx, identity.siteId, working.snapshot.assetVersions, patch, refreshResourceIds);
    const snapshot = buildCmsRevisionSnapshot({ ...working.snapshot, ...canonical, assetVersions, modelId: working.snapshot.modelId, ...(canonical.body !== undefined ? { bodyDocument: normalizeCmsContentDocument(canonical.body ?? '', patch.bodyDocument ?? working.snapshot.bodyDocument ?? undefined) } : {}) });
    await assertContentStaticPathFree(tx, identity.siteId, snapshot.staticPath);
    if (snapshot.tagIds.length) {
      const tags = await tx.select({ id: cmsTags.id }).from(cmsTags).where(and(eq(cmsTags.siteId, identity.siteId), inArray(cmsTags.id, snapshot.tagIds)));
      assertCompleteCmsBatch(snapshot.tagIds, tags.map((tag) => tag.id), '标签');
    }
    await tx.update(cmsContentWorkingCopies).set({ snapshot, version: sql`${cmsContentWorkingCopies.version} + 1`, editorialStatus: 'draft', rejectReason: null }).where(and(eq(cmsContentWorkingCopies.contentId, id), eq(cmsContentWorkingCopies.version, expectedVersion)));
    if (saveMode === 'manual') {
      const saved = await requireCmsWorkingCopy(tx, id);
      await freezeCmsContentRevision(tx, identity, saved, 'checkpoint', '人工保存工作稿');
    }
    await syncCmsResourceRefs(tx, 'content', id, identity.siteId, snapshot);
    await logContentOp(tx, id, 'updated', '保存独立工作稿，公开版本保持不变');
  });
  return options?.skipAccessCheck ? getCmsContent(id, { skipAccessCheck: true }) : getCmsContent(id);
}

export async function submitCmsContent(id: number, options?: { skipAccessCheck?: boolean; expectedVersion?: number }) {
  const identity = options?.skipAccessCheck ? await ensureCmsContentExists(id) : await requireCmsContentAccess(id);
  assertCmsContentUnlocked(identity);
  await assertNoActiveContentWorkflow(id);
  const site = await resolveEffectiveCmsSiteRow(identity.siteId);
  const settings = site.settings ?? {};
  const revision = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, identity.siteId);
    const working = await requireCmsWorkingCopy(tx, id, true);
    assertCmsContentVersion(working, options?.expectedVersion);
    if (identity.deletedAt || identity.archivedAt) throw new HTTPException(409, { message: '回收站或已归档内容不可提审' });
    await validateCmsModelExtend(working.snapshot.modelId, working.snapshot.extend, 'publish', working.snapshot.modelVersionId);
    assertContentTypeReady(cmsRevisionToContentRow(identity, working.snapshot));
    const frozen = await freezeCmsContentRevision(tx, identity, working, 'submission', '冻结提审稿');
    await tx.update(cmsContentWorkingCopies).set({ submittedRevisionId: frozen.id, approvedRevisionId: null, editorialStatus: 'pending', rejectReason: null, version: sql`${cmsContentWorkingCopies.version} + 1` }).where(eq(cmsContentWorkingCopies.contentId, id));
    await logContentOp(tx, id, 'submitted', `修订 #${frozen.id} ${frozen.hash}`);
    return frozen;
  });
  if (isWorkflowAuditEnabled(settings)) {
    try {
      const channel = await ensureChannelForContent(identity.siteId, revision.snapshot.channelId);
      let caller: { userId: number; username: string; tenantId: null; roles?: string[] } | undefined;
      if (options?.skipAccessCheck && !currentUserOrNull()) {
        if (!site.createdBy) throw new HTTPException(400, { message: '站点未配置工作流发起人' });
        const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, site.createdBy)).limit(1);
        requireRow(owner, '站点工作流发起人不存在', 400);
        caller = { userId: site.createdBy, username: owner.username, tenantId: null, roles: [] };
      }
      const instance = await startCmsContentWorkflow({ contentId: id, revisionId: revision.id, revisionHash: revision.hash, title: revision.title, siteName: site.name, channelName: channel.name, settings, caller });
      await bindCmsReviewRevision(id, instance.id, revision.id);
    } catch (error) {
      await db.update(cmsContentWorkingCopies).set({ editorialStatus: 'draft', submittedRevisionId: null }).where(and(eq(cmsContentWorkingCopies.contentId, id), eq(cmsContentWorkingCopies.submittedRevisionId, revision.id)));
      throw error;
    }
  }
  return getCmsContent(id, { skipAccessCheck: options?.skipAccessCheck });
}

export interface PublishCmsContentOptions { fromWorkflow?: boolean; skipAccessCheck?: boolean; expectedVersion?: number; revisionId?: number; scheduledAtBefore?: Date }

export function assertLockedCmsPublishPreconditions(_initialStatus: CmsContentStatus, locked: CmsContentRow, opts?: PublishCmsContentOptions): void {
  assertCmsContentUnlocked(locked);
  if (locked.deletedAt || locked.archivedAt) throw new HTTPException(409, { message: '回收站或已归档内容不可发布' });
  if (opts?.scheduledAtBefore && (!locked.scheduledAt || locked.scheduledAt > opts.scheduledAtBefore)) throw new HTTPException(409, { message: '定时发布条件已变化' });
  assertContentTypeReady(locked);
}

/** Approve/freeze the exact subject and submit an implicit release; activation owns the public projection. */
export async function prepareCmsContentPublication(id: number, options?: PublishCmsContentOptions) {
  const identity = options?.skipAccessCheck ? await ensureCmsContentExists(id) : await requireCmsContentAccess(id);
  assertCmsContentUnlocked(identity);
  if (!options?.fromWorkflow) await assertNoActiveContentWorkflow(id);
  const site = await resolveEffectiveCmsSiteRow(identity.siteId);
  const prepared = await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, identity.siteId);
    const working = await requireCmsWorkingCopy(tx, id, true);
    if (!options?.fromWorkflow) assertCmsContentVersion(working, options?.expectedVersion);
    const [currentIdentity] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    if (!currentIdentity || currentIdentity.deletedAt || currentIdentity.archivedAt) throw new HTTPException(409, { message: '回收站或已归档内容不可发布' });
    assertCmsContentUnlocked(currentIdentity);
    const requestedId = options?.revisionId ?? (working.editorialStatus === 'pending' ? working.submittedRevisionId : working.editorialStatus === 'approved' ? working.approvedRevisionId : null);
    const revision = requestedId ? await loadCmsRevision(tx, requestedId) : await freezeCmsContentRevision(tx, currentIdentity, working, 'publication', '冻结发布稿');
    if (revision.contentId !== id) throw new HTTPException(409, { message: '发布修订不属于当前内容' });
    if (isWorkflowAuditEnabled(site.settings) && working.approvedRevisionId !== revision.id) throw new HTTPException(409, { message: '该修订尚未通过工作流审核' });
    assertContentTypeReady(cmsRevisionToContentRow(identity, revision.snapshot));
    await validateCmsModelExtend(revision.snapshot.modelId, revision.snapshot.extend, 'publish', revision.snapshot.modelVersionId);
    if (options?.scheduledAtBefore && (!revision.snapshot.scheduledAt || parseDateTimeInput(revision.snapshot.scheduledAt)! > options.scheduledAtBefore)) throw new HTTPException(409, { message: '定时发布条件已变化' });
    await approveCmsRevision(tx, revision.id);
    await tx.update(cmsContentWorkingCopies).set({ approvedRevisionId: revision.id, editorialStatus: working.editorialStatus === 'draft' && requestedId ? 'draft' : 'approved', version: sql`${cmsContentWorkingCopies.version} + 1` }).where(eq(cmsContentWorkingCopies.contentId, id));
    await logContentOp(tx, id, 'approved', `批准修订 #${revision.id}，等待发布单激活`);
    return { revisionId: revision.id, version: working.version + 1 };
  });
  return { contentId: id, siteId: identity.siteId, ...prepared };
}

export async function publishCmsContent(id: number, options?: PublishCmsContentOptions) {
  const prepared = await prepareCmsContentPublication(id, options);
  const { createCmsContentRelease } = await import('./cms-releases.service');
  await createCmsContentRelease({ contentId: id, revisionId: prepared.revisionId, expectedVersion: prepared.version });
  return getCmsContent(id, { skipAccessCheck: options?.skipAccessCheck });
}

export async function approveCmsContentForRelease(id: number, expectedVersion: number) {
  await prepareCmsContentPublication(id, { expectedVersion });
  return getCmsContent(id);
}

export async function rejectCmsContent(id: number, reason: string, options?: { fromWorkflow?: boolean; skipAccessCheck?: boolean; expectedVersion?: number; revisionId?: number }) {
  const identity = options?.skipAccessCheck ? await ensureCmsContentExists(id) : await requireCmsContentAccess(id);
  assertCmsContentUnlocked(identity);
  if (!options?.fromWorkflow) await assertNoActiveContentWorkflow(id);
  await db.transaction(async (tx) => {
    const working = await requireCmsWorkingCopy(tx, id, true);
    if (!options?.fromWorkflow) assertCmsContentVersion(working, options?.expectedVersion);
    if (!working.submittedRevisionId || (options?.revisionId && working.submittedRevisionId !== options.revisionId)) throw new HTTPException(409, { message: '提审修订已变化' });
    await tx.update(cmsContentWorkingCopies).set({ editorialStatus: working.editorialStatus === 'draft' ? 'draft' : 'rejected', approvedRevisionId: null, rejectReason: reason, version: sql`${cmsContentWorkingCopies.version} + 1` }).where(eq(cmsContentWorkingCopies.contentId, id));
    await logContentOp(tx, id, 'rejected', reason);
  });
  return getCmsContent(id, { skipAccessCheck: options?.skipAccessCheck });
}

export async function offlineCmsContent(id: number, options?: { skipAccessCheck?: boolean; expectedVersion?: number; expireAtBefore?: Date }) {
  const current = options?.skipAccessCheck ? await ensureCmsContentExists(id) : await requireCmsContentAccess(id);
  await assertCmsWidgetSourcesMutable('content', [id]);
  assertCmsContentUnlocked(current);
  await assertNoLockedCmsMappedCopies(id);
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, current.siteId);
    const working = await requireCmsWorkingCopy(tx, id, true);
    assertCmsContentVersion(working, options?.expectedVersion);
    const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    requireRow(locked, '内容不存在');
    if (!canTransitionCmsContentStatus(locked.status, 'offline')) throw new HTTPException(409, { message: '当前内容未发布' });
    const old = await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true });
    const [updated] = await tx.update(cmsContents).set({ status: 'offline', version: sql`${cmsContents.version} + 1` }).where(buildWhere(eq(cmsContents.id, id), isNull(cmsContents.lockedAt), options?.expireAtBefore ? lte(cmsContents.expireAt, options.expireAtBefore) : undefined)).returning();
    requireRow(updated, '内容状态已变化', 409);
    await tx.update(cmsContentWorkingCopies).set({ version: sql`${cmsContentWorkingCopies.version} + 1` }).where(eq(cmsContentWorkingCopies.contentId, id));
    await logContentOp(tx, id, 'offlined');
    const task = await insertContentPublishOutbox(tx, site, updated, 'offline', old.deletePaths, { build: false });
    const webhookTask = await insertCmsContentWebhookOutbox(tx, 'cms.content.offline', updated);
    return { task, webhookTask };
  });
  await enqueueCmsPublishOutboxes([mutation.task], `内容 #${id} 下线`);
  await enqueueCmsWebhookEvents([mutation.webhookTask]);
  return getCmsContent(id, { skipAccessCheck: options?.skipAccessCheck });
}

/** Restore the complete immutable snapshot into a new working copy; never publish as a side effect. */
export async function restoreCmsContentToVersion(contentId: number, versionId: number, expectedVersion: number) {
  const identity = await requireCmsContentAccess(contentId);
  assertCmsContentUnlocked(identity);
  if (identity.deletedAt || identity.archivedAt) throw new HTTPException(409, { message: '回收站或已归档内容不可回滚' });
  const revision = await loadCmsRevision(db, versionId);
  if (revision.contentId !== contentId) throw new HTTPException(404, { message: '版本不属于当前内容' });
  await assertChannelAccess(revision.snapshot.channelId);
  await assertChannelsAccess(revision.snapshot.extraChannelIds);
  await assertRelatedContentAccess(identity.siteId, revision.snapshot.relatedIds);
  await db.transaction(async (tx) => {
    await lockCmsSiteForMutation(tx, identity.siteId);
    const working = await requireCmsWorkingCopy(tx, contentId, true);
    assertCmsContentVersion(working, expectedVersion);
    // Restore the complete frozen document and dependency pins without resolving them back to latest resources.
    const [restored] = await tx.update(cmsContentWorkingCopies).set({ snapshot: revision.snapshot, editorialStatus: 'draft', rejectReason: null,
      version: sql`${cmsContentWorkingCopies.version} + 1`,
    }).where(and(eq(cmsContentWorkingCopies.contentId, contentId), eq(cmsContentWorkingCopies.version, expectedVersion))).returning();
    requireRow(restored, '工作稿已变化', 409);
    await freezeCmsContentRevision(tx, identity, restored, 'restore', `从修订 #${versionId} 完整恢复工作稿`);
    await syncCmsResourceRefs(tx, 'content', contentId, identity.siteId, revision.snapshot);
    await logContentOp(tx, contentId, 'rolled_back', `从修订 #${versionId} 恢复工作稿，未发布`);
  });
  return getCmsContent(contentId);
}
