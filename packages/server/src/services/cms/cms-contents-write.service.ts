import { requireRow } from '../../lib/db-assert';
import { eq, and, inArray, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContents, cmsContentTags, cmsTags, cmsChannels, cmsContentChannels, cmsContentRelations, cmsPages, users } from '../../db/schema';
import type { CmsContentRow, CmsSiteRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { buildWhere } from '../../lib/where-helpers';
import { contentSearchVector, contentSearchVectorOnUpdate } from './cms-search.service';
import { listCmsModelFields } from './cms-models.service';
import { assertChannelAccess, assertChannelsAccess } from './cms-channels.service';
import { snapshotContentVersion, restoreContentVersion } from './cms-versions.service';
import { logContentOp } from './cms-content-op-logs.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { currentUserOrNull } from '../../lib/context';
import { isWorkflowAuditEnabled, startCmsContentWorkflow, assertNoActiveContentWorkflow } from './cms-workflow.service';
import { enqueueCmsWebhookEvents, insertCmsContentWebhookOutbox } from './cms-webhook.service';
import { assertContentTemplateBySite } from './cms-template-refs.service';
import type { CmsContentAttachment, CmsSiteOpsSettings, CreateCmsContentInput, UpdateCmsContentInput, CmsContentStatus } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { buildCmsEntityLink, isCmsEntityLink } from '@zenith/shared/cms';
import { ensureCmsLinkTargetExists } from './cms-link.service';
import { extractFirstImage, normalizeAttachments } from './cms-body.service';
import { resolveCmsSiteOpsSettings } from './cms-site-settings';
import { sanitizeUserText } from './cms-sensitive-words.service';
import { replaceErrorProneWords } from './cms-error-prone-words.service';
import { assertCompleteCmsBatch } from './cms-access';
import {
  canTransitionCmsContentStatus, type CmsContentTransitionAction,
} from './cms-content-state';
import { requireCmsScheduledAtMutationPermission } from './cms-publish-permission';
import { assertCmsContentUnlocked, assertNoLockedCmsMappedCopies } from './cms-content-lock.service';
import { bumpCmsTemplateRefsRevision, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import { canonicalizeCmsResourceFields, syncCmsResourceRefs } from './cms-resource-refs.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import {
  enqueueCmsSubscriptionNotification,
  insertCmsSubscriptionNotificationOutbox,
} from './cms-stage4-tasks';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import logger from '../../lib/logger';
import { assertCmsWidgetSourcesMutable } from './cms-widgets.service';
import { submitCmsWidgetSourceRefreshSideEffect } from './cms-widget-tasks';
import { insertContentPublishOutbox, recalcTagContentCounts, ensureChannelForContent } from './cms-contents-internal';
import { ensureCmsContentExists, getCmsContent, mapCmsContent } from './cms-contents-query.service';
import { applyCmsModelFieldDefaults, validateCmsModelExtend } from './cms-model-extend';
import { sanitizeCmsHtml } from './cms-html-sanitizer';

// ─── 写入辅助 ─────────────────────────────────────────────────────────────────

/** 模型 searchable 字段的 extend 文本值（纳入全文索引） */
async function collectSearchableExtendTexts(modelId: number | null | undefined, extend: Record<string, unknown>): Promise<string[]> {
  if (!modelId) return [];
  const fields = await listCmsModelFields(modelId);
  return fields
    .filter((f) => f.searchable)
    .map((f) => extend[f.name])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** 先删后插替换内容标签，并重算受影响标签的 contentCount */
async function setContentTags(executor: DbExecutor, contentId: number, siteId: number, tagIds: number[]): Promise<void> {
  const previous = await executor.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(and(
    eq(cmsContentTags.contentId, contentId),
  ));
  await executor.delete(cmsContentTags).where(and(
    eq(cmsContentTags.contentId, contentId),
  ));
  if (tagIds.length > 0) {
    const validTags = await executor.select({ id: cmsTags.id }).from(cmsTags)
      .where(and(inArray(cmsTags.id, tagIds), eq(cmsTags.siteId, siteId)));
    if (validTags.length !== tagIds.length) {
      throw new HTTPException(400, { message: '存在无效标签或标签不属于当前站点' });
    }
    await executor.insert(cmsContentTags).values(tagIds.map((tagId) => ({ contentId, tagId })));
  }
  await recalcTagContentCounts(executor, [...previous.map((p) => p.tagId), ...tagIds]);
}

export async function ensureCmsContentTargetAccess(siteId: number, channelId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  await assertChannelAccess(channelId);
  const channel = await ensureChannelForContent(siteId, channelId);
  return { channel };
}

/** 形态结构化数据中的可检索文本（图集说明等纳入全文索引） */
function mediaDataTexts(mediaData: Record<string, unknown> | null | undefined): string[] {
  const images = (mediaData as { images?: { caption?: string | null }[] } | null)?.images;
  if (!Array.isArray(images)) return [];
  return images.map((img) => img?.caption).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
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

/** 先删后插替换副栏目（一文多栏目；副栏目须为本站列表栏目且 ≠ 主栏目） */
async function setContentExtraChannels(executor: DbExecutor, contentId: number, siteId: number, mainChannelId: number, extraChannelIds: number[]): Promise<void> {
  await executor.delete(cmsContentChannels).where(and(
    eq(cmsContentChannels.contentId, contentId),
  ));
  const targets = [...new Set(extraChannelIds)].filter((id) => id !== mainChannelId);
  if (targets.length === 0) return;
  const valid = await executor.select({ id: cmsChannels.id }).from(cmsChannels)
    .where(and(inArray(cmsChannels.id, targets), eq(cmsChannels.siteId, siteId), eq(cmsChannels.type, 'list')));
  if (valid.length !== targets.length) {
    throw new HTTPException(400, { message: '存在无效副栏目（须为本站点的列表栏目）' });
  }
  await executor.insert(cmsContentChannels).values(targets.map((channelId) => ({ contentId, channelId })));
}

/** 先删后插替换相关文章（须为本站内容且 ≠ 自身） */
async function setContentRelations(executor: DbExecutor, contentId: number, siteId: number, relatedIds: number[]): Promise<void> {
  await executor.delete(cmsContentRelations).where(and(
    eq(cmsContentRelations.contentId, contentId),
  ));
  const targets = [...new Set(relatedIds)].filter((id) => id !== contentId);
  if (targets.length === 0) return;
  const valid = await executor.select({ id: cmsContents.id }).from(cmsContents)
    .where(and(inArray(cmsContents.id, targets), eq(cmsContents.siteId, siteId), isNull(cmsContents.deletedAt)));
  if (valid.length !== targets.length) {
    throw new HTTPException(400, { message: '存在无效的相关文章（须为本站点内容）' });
  }

  await executor.insert(cmsContentRelations).values(targets.map((relatedId, index) => ({
    contentId,
    relatedId,
    sort: index,
  })));
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
  await assertChannelsAccess(rows.map((row) => row.channelId));
}

// ─── 属性自动标记（P4：保存时按正文/形态数据/封面检测含图/含视频/含附件）──────────
const ATTACHMENT_LINK_RE = /<a\b[^>]*href="[^"]*\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv)(?:[?#][^"]*)?"/i;

/** cms_contents 的多个唯一约束 → 精准错误提示（未命中回落到通用文案） */
const CMS_CONTENT_UNIQUE_MESSAGES = {
  cms_contents_site_slug_uq: '同站点下已存在相同 URL 标识的内容',
  cms_contents_site_static_path_uq: '同站点下已存在相同静态路径的内容',
} as const;

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

/** 站点关闭「已发布内容可编辑」时，拦截对已发布内容的直接编辑 */
function assertCmsContentEditable(current: CmsContentRow, site: Pick<CmsSiteRow, 'settings'>): void {
  if (current.status !== 'published') return;
  if (resolveCmsSiteOpsSettings(site.settings).publishedContentEditable) return;
  throw new HTTPException(400, { message: '站点已关闭「已发布内容可编辑」，请先下线内容再编辑' });
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsContent(data: CreateCmsContentInput) {
  const siteRow = await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  await assertChannelAccess(data.channelId);
  await assertContentTemplateBySite(data.siteId, data.detailTemplate);
  const channel = await ensureChannelForContent(data.siteId, data.channelId);
  const { tagIds = [], extraChannelIds = [], relatedIds = [], scheduledAt, expireAt, topExpireAt, ...raw } = data;
  const policied = await applyCmsContentPolicies(raw as typeof raw & CmsContentPolicyInput, siteRow);
  const parsedScheduledAt = parseDateTimeInput(scheduledAt);
  await requireCmsScheduledAtMutationPermission({
    current: null,
    requested: parsedScheduledAt,
  });
  await assertChannelsAccess(extraChannelIds);
  await assertRelatedContentAccess(data.siteId, relatedIds);
  await ensureCmsLinkTargetExists(data.siteId, policied.externalLink);
  const modelId = channel.modelId ?? null;
  // 模型字段：先回填 defaultValue（只补缺），再做草稿级校验（类型/选项合法性）
  policied.extend = await applyCmsModelFieldDefaults(modelId, (policied.extend ?? {}) as Record<string, unknown>);
  await validateCmsModelExtend(modelId, policied.extend as Record<string, unknown>, 'draft');
  const extendTexts = [
    ...await collectSearchableExtendTexts(modelId, (policied.extend ?? {}) as Record<string, unknown>),
    ...mediaDataTexts(policied.mediaData as Record<string, unknown>),
  ];
  // P5 部门数据权限：创建时快照创建人及其部门
  const creator = currentUserOrNull();
  const creatorDept = creator
    ? await db.query.users.findFirst({ where: eq(users.id, creator.userId), columns: { departmentId: true } })
    : null;
  try {
    const mutation = await db.transaction(async (tx) => {
      let site = await lockCmsSiteForMutation(tx, data.siteId);
      await assertContentStaticPathFree(tx, data.siteId, policied.staticPath);
      await assertContentTemplateBySite(data.siteId, data.detailTemplate);
      // 素材句柄归一化必须在事务内：会为文件中心引用补登记素材行，回滚时要一并撤销
      const rest = await canonicalizeCmsResourceFields(tx, data.siteId, policied, 'content');
      const [created] = await tx.insert(cmsContents).values({
        ...rest,
        extend: (rest.extend ?? {}) as Record<string, unknown>,
        modelId,
        createdBy: creator?.userId ?? null,
        deptId: creatorDept?.departmentId ?? null,
        scheduledAt: parsedScheduledAt,
        expireAt: parseDateTimeInput(expireAt),
        topExpireAt: parseDateTimeInput(topExpireAt),
        ...detectContentFlags({
          contentType: rest.contentType ?? 'article',
          body: rest.body,
          mediaData: rest.mediaData as Record<string, unknown>,
          coverImage: rest.coverImage,
          attachments: rest.attachments,
        }),
        searchVector: contentSearchVector(data.siteId, rest, extendTexts),
      }).returning();
      await setContentTags(tx, created.id, data.siteId, tagIds);
      await setContentExtraChannels(tx, created.id, data.siteId, created.channelId, extraChannelIds);
      await setContentRelations(tx, created.id, data.siteId, relatedIds);
      await syncCmsResourceRefs(tx, 'content', created.id, created.siteId, created);
      await logContentOp(tx, created.id, 'created');
      let refsTask: AsyncTask | null = null;
      if (created.detailTemplate) {
        const revision = await bumpCmsTemplateRefsRevision(tx, data.siteId);
        site = { ...site, templateRefsRevision: revision };
        refsTask = await insertCmsSiteRefsRebuildOutbox(
          tx,
          site,
          '内容模板引用创建',
          `site:${data.siteId}:refs:${revision}`,
        );
      }
      return { created, refsTask };
    });
    if (mutation.refsTask) await enqueueCmsPublishOutboxes([mutation.refsTask], `内容 #${mutation.created.id} 模板引用创建`);
    return getCmsContent(mutation.created.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 URL 标识的内容', CMS_CONTENT_UNIQUE_MESSAGES);
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsContent(
  id: number,
  data: UpdateCmsContentInput,
  options?: { suppressDistributionSideEffects?: boolean },
) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(current.channelId);
  assertCmsContentUnlocked(current);
  const siteRow = await ensureCmsSiteExists(current.siteId);
  assertCmsContentEditable(current, siteRow);
  await assertNoLockedCmsMappedCopies(id);
  await assertContentTemplateBySite(current.siteId, data.detailTemplate);
  let modelId = current.modelId;
  if (data.channelId && data.channelId !== current.channelId) {
    await assertChannelAccess(data.channelId);
    const channel = await ensureChannelForContent(current.siteId, data.channelId);
    modelId = channel.modelId ?? null;
  }
  const { tagIds, extraChannelIds, relatedIds, scheduledAt, expireAt, topExpireAt, expectedVersion, ...raw } = data;
  const rest = await applyCmsContentPolicies(
    raw as typeof raw & CmsContentPolicyInput,
    siteRow,
    { body: current.body, coverImage: current.coverImage },
  );
  const parsedScheduledAt = scheduledAt === undefined ? undefined : parseDateTimeInput(scheduledAt);
  await requireCmsScheduledAtMutationPermission({
    current: current.scheduledAt,
    requested: parsedScheduledAt,
  });
  if (extraChannelIds) await assertChannelsAccess(extraChannelIds);
  if (relatedIds) await assertRelatedContentAccess(current.siteId, relatedIds);
  if (rest.externalLink !== undefined) await ensureCmsLinkTargetExists(current.siteId, rest.externalLink);
  // 内部链接不能指向自己（保存后会形成自跳转死循环）
  if (isCmsEntityLink(rest.externalLink) && rest.externalLink === buildCmsEntityLink('content', id)) {
    throw new HTTPException(400, { message: '内部链接不能指向内容自身' });
  }
  // 乐观锁：携带 expectedVersion 时先行比对，冲突返回 409（前端提示刷新后重试）
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    throw new HTTPException(409, { message: '内容已被其他人修改，请刷新页面获取最新版本后再保存' });
  }
  // 映射内容：正文/扩展字段共享来源内容，禁止独立编辑（请编辑来源内容或改用独立复制）
  if (current.mappingSourceId && (rest.body !== undefined || rest.extend !== undefined)) {
    throw new HTTPException(400, { message: '映射内容的正文与扩展字段共享来源内容，不可独立编辑' });
  }
  const nextExtend = (rest.extend ?? current.extend ?? {}) as Record<string, unknown>;
  await validateCmsModelExtend(modelId, nextExtend, current.status === 'published' ? 'publish' : 'draft');
  const nextMediaData = (rest.mediaData ?? current.mediaData ?? {}) as Record<string, unknown>;
  const extendTexts = [...await collectSearchableExtendTexts(modelId, nextExtend), ...mediaDataTexts(nextMediaData)];
  try {
    const mutation = await db.transaction(async (tx) => {
      let site = await lockCmsSiteForMutation(tx, current.siteId);
      const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
      requireRow(locked, '内容不存在');
      if (rest.staticPath !== undefined) await assertContentStaticPathFree(tx, current.siteId, rest.staticPath);
      await assertContentTemplateBySite(current.siteId, data.detailTemplate);
      const oldPublish = locked.status === 'published'
        ? await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true })
        : null;
      // 更新前自动留档版本快照（可在编辑页回滚）
      await snapshotContentVersion(tx, locked, '更新前留档');
      const versionGuard = expectedVersion !== undefined
        ? and(eq(cmsContents.id, id), eq(cmsContents.version, expectedVersion), isNull(cmsContents.lockedAt))!
        : and(eq(cmsContents.id, id), isNull(cmsContents.lockedAt))!;
      // 素材句柄归一化必须在事务内：会为文件中心引用补登记素材行，回滚时要一并撤销
      const canonical = await canonicalizeCmsResourceFields(tx, current.siteId, rest, 'content');
      const [updated] = await tx.update(cmsContents).set({
        ...canonical,
        modelId,
        version: sql`${cmsContents.version} + 1`,
        ...(parsedScheduledAt !== undefined ? { scheduledAt: parsedScheduledAt } : {}),
        ...(expireAt !== undefined ? { expireAt: parseDateTimeInput(expireAt) } : {}),
        ...(topExpireAt !== undefined ? { topExpireAt: parseDateTimeInput(topExpireAt) } : {}),
        ...detectContentFlags({
          contentType: current.contentType,
          body: canonical.body !== undefined ? canonical.body : current.body,
          mediaData: nextMediaData,
          coverImage: rest.coverImage !== undefined ? rest.coverImage : current.coverImage,
          attachments: canonical.attachments !== undefined ? canonical.attachments : current.attachments,
        }),
        // 映射内容正文在来源行，保持自身检索向量不动（分发时已按来源快照写入）
        ...(current.mappingSourceId ? {} : {
          searchVector: contentSearchVectorOnUpdate(current, rest, extendTexts),
        }),
      }).where(versionGuard).returning();
      if (!updated) {
        throw new HTTPException(409, { message: '内容已被其他人修改，请刷新页面获取最新版本后再保存' });
      }
      if (tagIds) {
        await setContentTags(tx, id, current.siteId, tagIds);
      }
      if (extraChannelIds) {
        await setContentExtraChannels(tx, id, current.siteId, updated.channelId, extraChannelIds);
      }
      if (relatedIds) {
        await setContentRelations(tx, id, current.siteId, relatedIds);
      }
      await syncCmsResourceRefs(tx, 'content', id, updated.siteId, updated);
      await logContentOp(tx, id, 'updated');
      const webhookTask = await insertCmsContentWebhookOutbox(tx, 'cms.content.updated', updated);
      let refsTask: AsyncTask | null = null;
      if (data.detailTemplate !== undefined && data.detailTemplate !== locked.detailTemplate) {
        const revision = await bumpCmsTemplateRefsRevision(tx, current.siteId);
        site = { ...site, templateRefsRevision: revision };
        refsTask = await insertCmsSiteRefsRebuildOutbox(
          tx,
          site,
          '内容模板引用更新',
          `site:${current.siteId}:refs:${revision}`,
        );
      }
      const task = oldPublish
        ? await insertContentPublishOutbox(
            tx,
            site,
            updated,
            'update',
            oldPublish.deletePaths,
            {
              build: updated.status === 'published' && !updated.deletedAt && !updated.externalLink?.trim(),
              refreshChannelIds: [locked.channelId, updated.channelId],
            },
          )
        : null;
      return { task, refsTask, webhookTask, updated };
    });
    await enqueueCmsPublishOutboxes(
      [mutation.task, mutation.refsTask].filter((task): task is AsyncTask => task != null),
      `内容 #${id} 更新`,
    );
    await enqueueCmsWebhookEvents([mutation.webhookTask]);
    if (mutation.updated.status === 'published' && !mutation.updated.deletedAt) {
      submitCmsWidgetSourceRefreshSideEffect('content', [id]);
    }
    if (!options?.suppressDistributionSideEffects) {
      const { submitCmsMappingDistributionSideEffects } = await import('./cms-distributions.service');
      await submitCmsMappingDistributionSideEffects(id).catch((error) => {
        logger.warn(`[cms-distribution] 内容 #${id} 映射跟随任务提交失败`, error);
      });
    }
    return getCmsContent(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 URL 标识的内容', CMS_CONTENT_UNIQUE_MESSAGES);
  }
}

// ─── 状态流转 ─────────────────────────────────────────────────────────────────
async function transitionStatus(
  id: number,
  action: CmsContentTransitionAction,
  patch: Partial<typeof cmsContents.$inferInsert>,
  options?: { skipAccessCheck?: boolean },
) {
  const current = await ensureCmsContentExists(id);
  if (!options?.skipAccessCheck) {
    await assertSiteAccess(current.siteId);
    await assertChannelAccess(current.channelId);
  }
  assertCmsContentUnlocked(current);
  await assertNoLockedCmsMappedCopies(id);
  if (current.deletedAt) throw new HTTPException(400, { message: '回收站中的内容不可操作，请先恢复' });
  if (current.archivedAt) throw new HTTPException(400, { message: '已归档的内容不可操作，请先取消归档' });
  if (!canTransitionCmsContentStatus(current.status, action)) {
    throw new HTTPException(400, { message: `当前状态（${current.status}）不允许此操作` });
  }
  const [updated] = await db.update(cmsContents).set({
    ...patch,
    // Status transitions are content revisions too; otherwise an editor holding
    // an old optimistic-lock token can overwrite a newly submitted/rejected row.
    version: sql`${cmsContents.version} + 1`,
  }).where(and(
    eq(cmsContents.id, id),
    eq(cmsContents.status, current.status),
    isNull(cmsContents.lockedAt),
  )).returning();
  requireRow(updated, '内容状态已变化，请刷新后重试', 409);
  return options?.skipAccessCheck ? mapCmsContent(updated) : getCmsContent(id);
}

/** 提交审核：站点开启工作流审核模式时自动发起审核流程 */
export async function submitCmsContent(id: number, options?: { skipAccessCheck?: boolean }) {
  const current = await ensureCmsContentExists(id);
  if (!options?.skipAccessCheck) {
    await assertSiteAccess(current.siteId);
    await assertChannelAccess(current.channelId);
  }
  assertCmsContentUnlocked(current);
  const site = await resolveEffectiveCmsSiteRow(current.siteId);
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  // 提审即进入审核发布链：此处强校验模型必填，避免缺文号等硬伤流入审核队列
  await validateCmsModelExtend(current.modelId, (current.extend ?? {}) as Record<string, unknown>, 'publish');
  const result = await transitionStatus(id, 'submit', { status: 'pending', rejectReason: null }, options);
  await logContentOp(db, id, 'submitted');
  if (isWorkflowAuditEnabled(settings)) {
    try {
      const channel = await db.query.cmsChannels.findFirst({
        where: eq(cmsChannels.id, current.channelId),
        columns: { name: true },
      });
      let caller: { userId: number; username: string; tenantId: null; roles?: string[] } | undefined;
      if (options?.skipAccessCheck) {
        if (!site.createdBy) {
          throw new HTTPException(400, { message: '站点未配置可用的工作流发起人' });
        }
        const [siteCreator] = await db.select({ username: users.username }).from(users)
          .where(eq(users.id, site.createdBy)).limit(1);
        requireRow(siteCreator, '站点工作流发起人不存在', 400);
        caller = {
          userId: site.createdBy,
          username: siteCreator.username,
          tenantId: null,
          roles: [],
        };
      }
      await startCmsContentWorkflow({
        contentId: id,
        title: current.title,
        siteName: site.name,
        channelName: channel?.name ?? '',
        settings,
        caller,
      });
    } catch (err) {
      // 流程发起失败回退待审状态，避免内容卡在 pending 无人处理
      await db.update(cmsContents).set({ status: current.status }).where(and(
        eq(cmsContents.id, id),
        isNull(cmsContents.lockedAt),
      ));
      throw err;
    }
  }
  return result;
}

export interface PublishCmsContentOptions {
  fromWorkflow?: boolean;
  skipAccessCheck?: boolean;
  scheduledAtBefore?: Date;
}

export function assertLockedCmsPublishPreconditions(
  initialStatus: CmsContentStatus,
  locked: CmsContentRow,
  opts?: PublishCmsContentOptions,
): void {
  assertCmsContentUnlocked(locked);
  if (locked.status !== initialStatus || !canTransitionCmsContentStatus(locked.status, 'publish')) {
    throw new HTTPException(409, { message: '内容发布前置状态已变化，请刷新后重试' });
  }
  if (locked.deletedAt || locked.archivedAt) {
    throw new HTTPException(409, { message: '回收站或已归档内容不可发布' });
  }
  if (opts?.scheduledAtBefore && (
    !locked.scheduledAt
    || locked.scheduledAt.getTime() > opts.scheduledAtBefore.getTime()
  )) {
    throw new HTTPException(409, { message: '定时发布条件已变化，请等待下一轮调度' });
  }
  assertContentTypeReady(locked);
}

/** 发布（直接、审核通过、采集或定时发布均走此原子管道）。 */
export async function publishCmsContent(id: number, opts?: PublishCmsContentOptions) {
  const row = await ensureCmsContentExists(id);
  if (!opts?.skipAccessCheck) {
    await assertSiteAccess(row.siteId);
    await assertChannelAccess(row.channelId);
  }
  assertCmsContentUnlocked(row);
  if (!opts?.fromWorkflow) await assertNoActiveContentWorkflow(id);
  assertContentTypeReady(row);
  // 发布 = 内容对外可见的最终闸口：模型必填在此强制兜底（覆盖导入/采集/分发/Headless 等非表单通道）
  await validateCmsModelExtend(row.modelId, (row.extend ?? {}) as Record<string, unknown>, 'publish');
  if (!canTransitionCmsContentStatus(row.status, 'publish')) {
    throw new HTTPException(409, { message: `当前状态（${row.status}）不允许发布` });
  }
  if (row.deletedAt || row.archivedAt) {
    throw new HTTPException(400, { message: '回收站或已归档内容不可发布' });
  }
  const publication = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, row.siteId);
    const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    requireRow(locked, '内容不存在');
    assertLockedCmsPublishPreconditions(row.status, locked, opts);
    if (!opts?.fromWorkflow) await assertNoActiveContentWorkflow(id);
    const oldPublish = await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true });
    const where = buildWhere(
      eq(cmsContents.id, id),
      eq(cmsContents.status, locked.status),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.archivedAt),
      isNull(cmsContents.lockedAt),
      opts?.scheduledAtBefore ? isNotNull(cmsContents.scheduledAt) : undefined,
      opts?.scheduledAtBefore ? lte(cmsContents.scheduledAt, opts.scheduledAtBefore) : undefined,
    );
    const [updated] = await tx.update(cmsContents).set({
      status: 'published',
      publishedAt: new Date(),
      scheduledAt: null,
      rejectReason: null,
      version: sql`${cmsContents.version} + 1`,
    }).where(where).returning();
    requireRow(updated, '内容已发布或定时发布条件已变化', 409);
    await logContentOp(tx, id, 'published', opts?.fromWorkflow ? '工作流审核通过' : null);
    const task = await insertContentPublishOutbox(tx, site, updated, 'publish', oldPublish.deletePaths, { build: true });
    const notificationTask = await insertCmsSubscriptionNotificationOutbox(tx, updated);
    // 事件外推走事务 outbox：事务提交即代表事件不会丢，替代原先的 fire-and-forget
    const webhookTask = await insertCmsContentWebhookOutbox(tx, 'cms.content.published', updated);
    return { updated, task, notificationTask, webhookTask };
  });
  await enqueueCmsPublishOutboxes([publication.task], `内容 #${id} 发布`);
  await enqueueCmsSubscriptionNotification(publication.notificationTask);
  await enqueueCmsWebhookEvents([publication.webhookTask]);
  triggerCmsPublishedSideEffects(publication.updated);
  return opts?.skipAccessCheck ? mapCmsContent(publication.updated) : getCmsContent(id);
}

function triggerCmsPublishedSideEffects(row: CmsContentRow): void {
  void import('./cms-member-interaction.service').then(({ awardContributionPoints }) => {
    awardContributionPoints(row);
  });
  void import('./cms-push.service').then((pushService) => {
    pushService.triggerAutoPushForContent(row.id);
  });
  void import('./cms-short-link.service')
    .then(({ triggerShortLinkForContent }) => triggerShortLinkForContent(row.id))
    .catch((error) => logger.warn(`[cms-short-link] 内容 #${row.id} 发布后的短链生成失败`, error));
  void import('./cms-distributions.service')
    .then(({ submitCmsMappingDistributionSideEffects }) => submitCmsMappingDistributionSideEffects(row.id))
    .catch((error) => logger.warn(`[cms-distribution] 内容 #${row.id} 发布后的映射任务提交失败`, error));
}

/** 驳回；工作流审核期间禁止手动驳回 */
export async function rejectCmsContent(id: number, reason: string, opts?: { fromWorkflow?: boolean; skipAccessCheck?: boolean }) {
  if (!opts?.fromWorkflow) {
    const row = await ensureCmsContentExists(id);
    if (!opts?.skipAccessCheck) {
      await assertSiteAccess(row.siteId);
      await assertChannelAccess(row.channelId);
    }
    await assertNoActiveContentWorkflow(id);
  }
  const result = await transitionStatus(
    id,
    'reject',
    { status: 'rejected', rejectReason: reason },
    opts?.skipAccessCheck ? { skipAccessCheck: true } : undefined,
  );
  await logContentOp(db, id, 'rejected', reason);
  return result;
}

/** 下线 */
export async function offlineCmsContent(id: number, options?: { skipAccessCheck?: boolean; expireAtBefore?: Date }) {
  const current = await ensureCmsContentExists(id);
  if (!options?.skipAccessCheck) {
    await assertSiteAccess(current.siteId);
    await assertChannelAccess(current.channelId);
  }
  await assertCmsWidgetSourcesMutable('content', [id]);
  assertCmsContentUnlocked(current);
  await assertNoLockedCmsMappedCopies(id);
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, current.siteId);
    const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    requireRow(locked, '内容不存在');
    await assertCmsWidgetSourcesMutable('content', [id], tx);
    if (!canTransitionCmsContentStatus(locked.status, 'offline')) {
      throw new HTTPException(400, { message: `当前状态（${locked.status}）不允许此操作` });
    }
    const oldPublish = await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true });
    const [updated] = await tx.update(cmsContents).set({
      status: 'offline',
      version: sql`${cmsContents.version} + 1`,
    }).where(and(
      eq(cmsContents.id, id),
      eq(cmsContents.status, locked.status),
      isNull(cmsContents.lockedAt),
      ...(options?.expireAtBefore ? [isNotNull(cmsContents.expireAt), lte(cmsContents.expireAt, options.expireAtBefore)] : []),
    )).returning();
    requireRow(updated, '内容状态已变化，请刷新后重试', 409);
    await logContentOp(tx, id, 'offlined');
    const task = await insertContentPublishOutbox(tx, site, updated, 'offline', oldPublish.deletePaths, { build: false });
    const webhookTask = await insertCmsContentWebhookOutbox(tx, 'cms.content.offline', updated);
    return { updated, task, webhookTask };
  });
  await enqueueCmsPublishOutboxes([mutation.task], `内容 #${id} 下线`);
  await enqueueCmsWebhookEvents([mutation.webhookTask]);
  void import('./cms-distributions.service')
    .then(({ submitCmsMappingDistributionSideEffects }) => submitCmsMappingDistributionSideEffects(id))
    .catch((error) => logger.warn(`[cms-distribution] 内容 #${id} 下线后的映射任务提交失败`, error));
  return options?.skipAccessCheck ? mapCmsContent(mutation.updated) : getCmsContent(id);
}

/** 回滚内容到指定版本（复用更新管道：重算检索向量并留档） */
export async function restoreCmsContentToVersion(contentId: number, versionId: number) {
  const current = await ensureCmsContentExists(contentId);
  const snapshot = await restoreContentVersion(contentId, versionId);
  // 映射内容正文/扩展字段共享来源行，回滚仅作用于自身元数据
  if (current.mappingSourceId) {
    delete snapshot.body;
    delete snapshot.extend;
  }
  const result = await updateCmsContent(contentId, snapshot as UpdateCmsContentInput);
  await logContentOp(db, contentId, 'rolled_back');
  return result;
}
