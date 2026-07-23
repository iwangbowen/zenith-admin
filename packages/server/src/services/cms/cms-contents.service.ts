import { eq, asc, desc, and, or, like, inArray, notInArray, isNull, isNotNull, ne, lt, gt, lte, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSites, cmsContents, cmsContentTags, cmsTags, cmsChannels, cmsContentChannels, cmsContentRelations, cmsCollectItems, users } from '../../db/schema';
import type { CmsContentRow, CmsTagRow } from '../../db/schema';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { config } from '../../config';
import redis from '../../lib/redis';
import { buildSearchVector } from './cms-search.service';
import { listCmsModelFields } from './cms-models.service';
import { ensureCmsChannelExists, getAccessibleChannelIds, assertChannelAccess, assertChannelsAccess } from './cms-channels.service';
import { snapshotContentVersion, restoreContentVersion } from './cms-versions.service';
import { logContentOp, logContentOps } from './cms-content-op-logs.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { getDataScopeCondition } from '../../lib/data-scope';
import { currentUserOrNull } from '../../lib/context';
import { isWorkflowAuditEnabled, startCmsContentWorkflow, assertNoActiveContentWorkflow } from './cms-workflow.service';
import { triggerCmsContentWebhook } from './cms-webhook.service';
import { assertContentTemplateBySite } from './cms-template-refs.service';
import type { AsyncTask, CmsContentPublishSnapshot, CreateCmsContentInput, UpdateCmsContentInput, CmsContentStatus } from '@zenith/shared';
import {
  assertCompleteCmsBatch, } from './cms-access';
import { pageOffset } from '../../lib/pagination';
import {
  canTransitionCmsContentStatus, type CmsContentTransitionAction,
} from './cms-content-state';
import { requireCmsScheduledAtMutationPermission } from './cms-publish-permission';
import {
  assertCmsContentUnlocked, assertCmsContentsUnlocked, assertNoLockedCmsMappedCopies,
} from './cms-content-lock.service';
import {
  bumpCmsTemplateRefsRevision,
  cmsSiteFencePayload,
  lockCmsSiteForMutation,
} from './cms-site-publish-lock.service';
import { captureCmsContentPublishSnapshot } from './cms-content-publish-snapshot.service';
import { enqueueCmsPublishOutboxes, insertCmsPublishOutbox, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';

async function insertContentPublishOutbox(
  tx: DbTransaction,
  site: typeof cmsSites.$inferSelect,
  row: CmsContentRow,
  action: string,
  deletePaths: readonly string[],
  options?: { build?: boolean; purged?: boolean; refreshChannelIds?: number[]; snapshot?: CmsContentPublishSnapshot },
): Promise<AsyncTask> {
  const captured = options?.snapshot
    ? { snapshot: { ...options.snapshot, build: options.build ?? options.snapshot.build, purged: options.purged ?? options.snapshot.purged } }
    : await captureCmsContentPublishSnapshot(tx, row, {
        build: options?.build,
        purged: options?.purged,
        refreshChannelIds: options?.refreshChannelIds,
      });
  const { expectedTemplateRefsRevision: _refsRevision, ...siteFence } = await cmsSiteFencePayload(tx, site);
  return insertCmsPublishOutbox(tx, {
    siteId: row.siteId,
    targetType: 'content',
    contentIds: [row.id],
    contentSnapshots: [captured.snapshot],
    deletePaths: [...new Set(deletePaths)].sort(),
    ...siteFence,
    reason: `内容 ${action} 静态发布`,
  }, `content:${row.id}:version:${row.version}:${action}`);
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsContent(row: CmsContentRow, extra?: { channelName?: string | null; tags?: CmsTagRow[]; extraChannelIds?: number[]; relatedIds?: number[]; mappingSourceTitle?: string | null; lockedByName?: string | null }) {
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: extra?.channelName ?? null,
    modelId: row.modelId ?? null,
    contentType: row.contentType,
    mediaData: row.mediaData ?? {},
    title: row.title,
    subTitle: row.subTitle ?? null,
    shortTitle: row.shortTitle ?? null,
    slug: row.slug ?? null,
    summary: row.summary ?? null,
    coverImage: row.coverImage ?? null,
    coverThumb: row.coverThumb ?? null,
    author: row.author ?? null,
    editor: row.editor ?? null,
    source: row.source ?? null,
    sourceUrl: row.sourceUrl ?? null,
    isOriginal: row.isOriginal,
    body: row.body ?? null,
    extend: row.extend ?? {},
    externalLink: row.externalLink ?? null,
    detailTemplate: row.detailTemplate ?? null,
    isTop: row.isTop,
    topWeight: row.topWeight,
    topExpireAt: formatNullableDateTime(row.topExpireAt),
    isRecommend: row.isRecommend,
    isHot: row.isHot,
    hasImage: row.hasImage,
    hasVideo: row.hasVideo,
    hasAttachment: row.hasAttachment,
    status: row.status,
    rejectReason: row.rejectReason ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    scheduledAt: formatNullableDateTime(row.scheduledAt),
    expireAt: formatNullableDateTime(row.expireAt),
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    favoriteCount: row.favoriteCount,
    version: row.version,
    sort: row.sort,
    seoTitle: row.seoTitle ?? null,
    seoKeywords: row.seoKeywords ?? null,
    seoDescription: row.seoDescription ?? null,
    socialImageAlt: row.socialImageAlt ?? null,
    twitterCreator: row.twitterCreator ?? null,
    memberId: row.memberId ?? null,
    archivedAt: formatNullableDateTime(row.archivedAt),
    mappingSourceId: row.mappingSourceId ?? null,
    mappingSourceTitle: extra?.mappingSourceTitle ?? null,
    lockedAt: formatNullableDateTime(row.lockedAt),
    lockedBy: row.lockedBy ?? null,
    lockedByName: extra?.lockedByName ?? null,
    lockReason: row.lockReason ?? null,
    ...(extra?.tags ? {
      tags: extra.tags.map((t) => ({
        id: t.id, siteId: t.siteId, name: t.name, slug: t.slug, groupName: t.groupName ?? null, contentCount: t.contentCount,
        createdAt: formatDateTime(t.createdAt), updatedAt: formatDateTime(t.updatedAt),
      })),
      tagIds: extra.tags.map((t) => t.id),
    } : {}),
    ...(extra?.extraChannelIds ? { extraChannelIds: extra.extraChannelIds } : {}),
    ...(extra?.relatedIds ? { relatedIds: extra.relatedIds } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsContentExists(id: number): Promise<CmsContentRow> {
  const [row] = await db.select().from(cmsContents).where(eq(cmsContents.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '内容不存在' });
  return row;
}

export async function getCmsContent(id: number) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(current.channelId);
  const row = await db.query.cmsContents.findFirst({
    where: eq(cmsContents.id, id),
    with: {
      channel: { columns: { name: true } },
      contentTags: { with: { tag: true } },
      extraChannels: { columns: { channelId: true } },
      relatedContents: { columns: { relatedId: true, sort: true } },
      mappingSource: { columns: { title: true, body: true, extend: true } },
      lockedByUser: { columns: { nickname: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '内容不存在' });
  const mapped = mapCmsContent(row, {
    channelName: row.channel?.name,
    tags: row.contentTags.map((ct) => ct.tag),
    extraChannelIds: row.extraChannels.map((ec) => ec.channelId),
    relatedIds: [...row.relatedContents].sort((a, b) => a.sort - b.sort).map((r) => r.relatedId),
    mappingSourceTitle: row.mappingSource?.title ?? null,
    lockedByName: row.lockedByUser?.nickname ?? null,
  });
  // 映射内容：正文/扩展字段透传来源内容（只读展示；本行自身不存正文）
  if (row.mappingSourceId && row.mappingSource) {
    mapped.body = row.mappingSource.body ?? null;
    mapped.extend = row.mappingSource.extend ?? {};
  }
  return mapped;
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsContentsQuery {
  siteId: number;
  channelId?: number;
  status?: CmsContentStatus;
  contentType?: 'article' | 'album' | 'media' | 'link';
  keyword?: string;
  isTop?: boolean;
  isRecommend?: boolean;
  isHot?: boolean;
  /** true = 回收站列表 */
  deleted?: boolean;
  /** true = 仅归档内容；false/未传 = 排除归档内容 */
  archived?: boolean;
  startTime?: string;
  endTime?: string;
  page: number;
  pageSize: number;
}

export async function listCmsContents(q: ListCmsContentsQuery) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  if (q.channelId) await assertChannelAccess(q.channelId);
  const conditions: SQL[] = [
    eq(cmsContents.siteId, q.siteId),
  ];
  const accessibleChannelIds = await getAccessibleChannelIds();
  if (accessibleChannelIds !== null) conditions.push(inArray(cmsContents.channelId, accessibleChannelIds));
  conditions.push(q.deleted ? isNotNull(cmsContents.deletedAt) : isNull(cmsContents.deletedAt));
  // 归档独立视图：默认列表排除归档，archived=true 仅看归档（回收站视图不叠加归档过滤）
  if (!q.deleted) conditions.push(q.archived ? isNotNull(cmsContents.archivedAt) : isNull(cmsContents.archivedAt));
  if (q.channelId) conditions.push(eq(cmsContents.channelId, q.channelId));
  if (q.status) conditions.push(eq(cmsContents.status, q.status));
  if (q.contentType) conditions.push(eq(cmsContents.contentType, q.contentType));
  if (q.isTop !== undefined) conditions.push(eq(cmsContents.isTop, q.isTop));
  if (q.isRecommend !== undefined) conditions.push(eq(cmsContents.isRecommend, q.isRecommend));
  if (q.isHot !== undefined) conditions.push(eq(cmsContents.isHot, q.isHot));
  if (q.keyword) {
    const kw = or(
      like(cmsContents.title, `%${escapeLike(q.keyword)}%`),
      like(cmsContents.author, `%${escapeLike(q.keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  const start = parseDateTimeInput(q.startTime);
  const end = parseDateTimeInput(q.endTime);
  if (start) conditions.push(gt(cmsContents.createdAt, start));
  if (end) conditions.push(lt(cmsContents.createdAt, end));

  // P5 部门数据权限：按创建时快照的部门/创建人过滤
  const scopeUser = currentUserOrNull();
  if (scopeUser) {
    const scopeCondition = await getDataScopeCondition({
      currentUserId: scopeUser.userId,
      deptColumn: cmsContents.deptId,
      ownerColumn: cmsContents.createdBy,
    });
    if (scopeCondition) conditions.push(scopeCondition);
  }

  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    db.query.cmsContents.findMany({
      where,
      with: {
        channel: { columns: { name: true } },
        lockedByUser: { columns: { nickname: true } },
      },
      orderBy: [desc(cmsContents.isTop), desc(cmsContents.topWeight), desc(cmsContents.id)],
      limit: q.pageSize,
      offset: pageOffset(q.page, q.pageSize),
    }),
  ]);
  return {
    list: rows.map((r) => mapCmsContent(r, {
      channelName: r.channel?.name,
      lockedByName: r.lockedByUser?.nickname ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

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

/** 单条 SQL 重算标签冗余计数（关联子查询，避免逐标签 COUNT 的 N+1 与竞态） */
async function recalcTagContentCounts(executor: DbExecutor, tagIds: number[]): Promise<void> {
  if (tagIds.length === 0) return;
  await executor.update(cmsTags)
    .set({ contentCount: sql<number>`(select count(*)::int from ${cmsContentTags} where ${cmsContentTags.tagId} = ${cmsTags.id})` })
    .where(inArray(cmsTags.id, [...new Set(tagIds)]));
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

/** 校验栏目归属与类型（内容只能挂在本站点的列表栏目下） */
async function ensureChannelForContent(siteId: number, channelId: number) {
  const channel = await ensureCmsChannelExists(channelId);
  if (channel.siteId !== siteId) throw new HTTPException(400, { message: '栏目不属于当前站点' });
  if (channel.type !== 'list') throw new HTTPException(400, { message: '只有列表栏目可以发布内容' });
  return channel;
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

// ─── 标题查重（P4：编辑辅助提示，不阻断保存；排除回收站与自身）───────────────────
export async function checkCmsContentTitle(siteId: number, title: string, excludeId?: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const conditions: SQL[] = [
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.title, title.trim()),
    isNull(cmsContents.deletedAt),
  ];
  const accessibleChannelIds = await getAccessibleChannelIds();
  if (accessibleChannelIds !== null) conditions.push(inArray(cmsContents.channelId, accessibleChannelIds));
  if (excludeId) conditions.push(ne(cmsContents.id, excludeId));
  const rows = await db.select({ id: cmsContents.id, title: cmsContents.title, status: cmsContents.status, channelId: cmsContents.channelId })
    .from(cmsContents)
    .where(and(...conditions))
    .orderBy(desc(cmsContents.id))
    .limit(5);
  return {
    duplicate: rows.length > 0,
    matches: rows.map((r) => ({ id: r.id, title: r.title, status: r.status })),
  };
}

// ─── 属性自动标记（P4：保存时按正文/形态数据/封面检测含图/含视频/含附件）──────────
const ATTACHMENT_LINK_RE = /<a\b[^>]*href="[^"]*\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv)(?:[?#][^"]*)?"/i;

export function detectContentFlags(input: {
  contentType: string;
  body: string | null | undefined;
  mediaData: Record<string, unknown> | null | undefined;
  coverImage: string | null | undefined;
}): { hasImage: boolean; hasVideo: boolean; hasAttachment: boolean } {
  const body = input.body ?? '';
  const media = input.mediaData ?? {};
  const albumImages = Array.isArray((media as { images?: unknown[] }).images) ? (media as { images: unknown[] }).images : [];
  const hasImage = Boolean(input.coverImage)
    || /<img\b/i.test(body)
    || (input.contentType === 'album' && albumImages.length > 0);
  const hasVideo = /<video\b|<iframe\b[^>]*(?:youtube|bilibili|qq\.com\/txp)/i.test(body)
    || (input.contentType === 'media' && (media as { mediaType?: string }).mediaType === 'video');
  const hasAttachment = ATTACHMENT_LINK_RE.test(body) || /<a\b[^>]*href="[^"]*\/api\/files\//i.test(body);
  return { hasImage, hasVideo, hasAttachment };
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsContent(data: CreateCmsContentInput) {
  await ensureCmsSiteExists(data.siteId);
  await assertSiteAccess(data.siteId);
  await assertChannelAccess(data.channelId);
  await assertContentTemplateBySite(data.siteId, data.detailTemplate);
  const channel = await ensureChannelForContent(data.siteId, data.channelId);
  const { tagIds = [], extraChannelIds = [], relatedIds = [], scheduledAt, expireAt, topExpireAt, ...rest } = data;
  const parsedScheduledAt = parseDateTimeInput(scheduledAt);
  await requireCmsScheduledAtMutationPermission({
    current: null,
    requested: parsedScheduledAt,
  });
  await assertChannelsAccess(extraChannelIds);
  await assertRelatedContentAccess(data.siteId, relatedIds);
  const extend = (rest.extend ?? {}) as Record<string, unknown>;
  const modelId = channel.modelId ?? null;
  const extendTexts = [...await collectSearchableExtendTexts(modelId, extend), ...mediaDataTexts(rest.mediaData as Record<string, unknown>)];
  // P5 部门数据权限：创建时快照创建人及其部门
  const creator = currentUserOrNull();
  const creatorDept = creator
    ? await db.query.users.findFirst({ where: eq(users.id, creator.userId), columns: { departmentId: true } })
    : null;
  try {
    const mutation = await db.transaction(async (tx) => {
      let site = await lockCmsSiteForMutation(tx, data.siteId);
      await assertContentTemplateBySite(data.siteId, data.detailTemplate);
      const [created] = await tx.insert(cmsContents).values({
        ...rest,
        extend,
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
        }),
        searchVector: buildSearchVector({
          siteId: data.siteId,
          title: rest.title,
          seoKeywords: rest.seoKeywords,
          summary: rest.summary,
          body: rest.body,
          extendTexts,
        }),
      }).returning();
      await setContentTags(tx, created.id, data.siteId, tagIds);
      await setContentExtraChannels(tx, created.id, data.siteId, created.channelId, extraChannelIds);
      await setContentRelations(tx, created.id, data.siteId, relatedIds);
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
    rethrowPgUniqueViolation(err, '同站点下已存在相同 URL 标识的内容');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsContent(id: number, data: UpdateCmsContentInput) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(current.channelId);
  assertCmsContentUnlocked(current);
  await assertNoLockedCmsMappedCopies(id);
  await assertContentTemplateBySite(current.siteId, data.detailTemplate);
  let modelId = current.modelId;
  if (data.channelId && data.channelId !== current.channelId) {
    await assertChannelAccess(data.channelId);
    const channel = await ensureChannelForContent(current.siteId, data.channelId);
    modelId = channel.modelId ?? null;
  }
  const { tagIds, extraChannelIds, relatedIds, scheduledAt, expireAt, topExpireAt, expectedVersion, ...rest } = data;
  const parsedScheduledAt = scheduledAt === undefined ? undefined : parseDateTimeInput(scheduledAt);
  await requireCmsScheduledAtMutationPermission({
    current: current.scheduledAt,
    requested: parsedScheduledAt,
  });
  if (extraChannelIds) await assertChannelsAccess(extraChannelIds);
  if (relatedIds) await assertRelatedContentAccess(current.siteId, relatedIds);
  // 乐观锁：携带 expectedVersion 时先行比对，冲突返回 409（前端提示刷新后重试）
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    throw new HTTPException(409, { message: '内容已被其他人修改，请刷新页面获取最新版本后再保存' });
  }
  // 映射内容：正文/扩展字段共享来源内容，禁止独立编辑（请编辑来源内容或改用独立复制）
  if (current.mappingSourceId && (rest.body !== undefined || rest.extend !== undefined)) {
    throw new HTTPException(400, { message: '映射内容的正文与扩展字段共享来源内容，不可独立编辑' });
  }
  const nextExtend = (rest.extend ?? current.extend ?? {}) as Record<string, unknown>;
  const nextMediaData = (rest.mediaData ?? current.mediaData ?? {}) as Record<string, unknown>;
  const extendTexts = [...await collectSearchableExtendTexts(modelId, nextExtend), ...mediaDataTexts(nextMediaData)];
  try {
    const mutation = await db.transaction(async (tx) => {
      let site = await lockCmsSiteForMutation(tx, current.siteId);
      const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
      if (!locked) throw new HTTPException(404, { message: '内容不存在' });
      await assertContentTemplateBySite(current.siteId, data.detailTemplate);
      const oldPublish = locked.status === 'published'
        ? await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true })
        : null;
      // 更新前自动留档版本快照（可在编辑页回滚）
      await snapshotContentVersion(tx, locked, '更新前留档');
      const versionGuard = expectedVersion !== undefined
        ? and(eq(cmsContents.id, id), eq(cmsContents.version, expectedVersion), isNull(cmsContents.lockedAt))!
        : and(eq(cmsContents.id, id), isNull(cmsContents.lockedAt))!;
      const [updated] = await tx.update(cmsContents).set({
        ...rest,
        modelId,
        version: sql`${cmsContents.version} + 1`,
        ...(parsedScheduledAt !== undefined ? { scheduledAt: parsedScheduledAt } : {}),
        ...(expireAt !== undefined ? { expireAt: parseDateTimeInput(expireAt) } : {}),
        ...(topExpireAt !== undefined ? { topExpireAt: parseDateTimeInput(topExpireAt) } : {}),
        ...detectContentFlags({
          contentType: current.contentType,
          body: rest.body !== undefined ? rest.body : current.body,
          mediaData: nextMediaData,
          coverImage: rest.coverImage !== undefined ? rest.coverImage : current.coverImage,
        }),
        // 映射内容正文在来源行，保持自身检索向量不动（分发时已按来源快照写入）
        ...(current.mappingSourceId ? {} : {
          searchVector: buildSearchVector({
            siteId: current.siteId,
            title: rest.title ?? current.title,
            seoKeywords: rest.seoKeywords !== undefined ? rest.seoKeywords : current.seoKeywords,
            summary: rest.summary !== undefined ? rest.summary : current.summary,
            body: rest.body !== undefined ? rest.body : current.body,
            extendTexts,
          }),
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
      await logContentOp(tx, id, 'updated');
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
      return { task, refsTask };
    });
    await enqueueCmsPublishOutboxes(
      [mutation.task, mutation.refsTask].filter((task): task is AsyncTask => task != null),
      `内容 #${id} 更新`,
    );
    return getCmsContent(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同 URL 标识的内容');
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
  if (current.deletedAt) throw new HTTPException(400, { message: '回收站中的内容不可操作，请先恢复' });
  if (current.archivedAt) throw new HTTPException(400, { message: '已归档的内容不可操作，请先取消归档' });
  if (!canTransitionCmsContentStatus(current.status, action)) {
    throw new HTTPException(400, { message: `当前状态（${current.status}）不允许此操作` });
  }
  const [updated] = await db.update(cmsContents).set(patch).where(and(
    eq(cmsContents.id, id),
    eq(cmsContents.status, current.status),
    isNull(cmsContents.lockedAt),
  )).returning();
  if (!updated) throw new HTTPException(409, { message: '内容状态已变化，请刷新后重试' });
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
  const site = await db.select().from(cmsSites).where(eq(cmsSites.id, current.siteId)).limit(1).then((rows) => rows[0]);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  const settings = (site.settings ?? {}) as Record<string, unknown>;
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
        if (!siteCreator) throw new HTTPException(400, { message: '站点工作流发起人不存在' });
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
  if (!canTransitionCmsContentStatus(row.status, 'publish')) {
    throw new HTTPException(409, { message: `当前状态（${row.status}）不允许发布` });
  }
  if (row.deletedAt || row.archivedAt) {
    throw new HTTPException(400, { message: '回收站或已归档内容不可发布' });
  }
  const publication = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, row.siteId);
    const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    if (!locked) throw new HTTPException(404, { message: '内容不存在' });
    assertLockedCmsPublishPreconditions(row.status, locked, opts);
    if (!opts?.fromWorkflow) await assertNoActiveContentWorkflow(id);
    const oldPublish = await captureCmsContentPublishSnapshot(tx, locked, { includeExistingArtifacts: true });
    const conditions: SQL[] = [
      eq(cmsContents.id, id),
      eq(cmsContents.status, locked.status),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.archivedAt),
      isNull(cmsContents.lockedAt),
    ];
    if (opts?.scheduledAtBefore) {
      conditions.push(isNotNull(cmsContents.scheduledAt), lte(cmsContents.scheduledAt, opts.scheduledAtBefore));
    }
    const [updated] = await tx.update(cmsContents).set({
      status: 'published',
      publishedAt: new Date(),
      scheduledAt: null,
      rejectReason: null,
      version: sql`${cmsContents.version} + 1`,
    }).where(and(...conditions)).returning();
    if (!updated) throw new HTTPException(409, { message: '内容已发布或定时发布条件已变化' });
    await logContentOp(tx, id, 'published', opts?.fromWorkflow ? '工作流审核通过' : null);
    const task = await insertContentPublishOutbox(tx, site, updated, 'publish', oldPublish.deletePaths, { build: true });
    return { updated, task };
  });
  await enqueueCmsPublishOutboxes([publication.task], `内容 #${id} 发布`);
  triggerCmsPublishedSideEffects(publication.updated);
  return opts?.skipAccessCheck ? mapCmsContent(publication.updated) : getCmsContent(id);
}

function triggerCmsPublishedSideEffects(row: CmsContentRow): void {
  void import('./cms-member-interaction.service').then(({ awardContributionPoints }) => {
    awardContributionPoints(row);
  });
  triggerCmsContentWebhook('content.published', row.id);
  void import('./cms-push.service').then((pushService) => {
    pushService.triggerAutoPushForContent(row.id);
  });
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
  assertCmsContentUnlocked(current);
  const mutation = await db.transaction(async (tx) => {
    const site = await lockCmsSiteForMutation(tx, current.siteId);
    const [locked] = await tx.select().from(cmsContents).where(eq(cmsContents.id, id)).for('update').limit(1);
    if (!locked) throw new HTTPException(404, { message: '内容不存在' });
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
    if (!updated) throw new HTTPException(409, { message: '内容状态已变化，请刷新后重试' });
    await logContentOp(tx, id, 'offlined');
    const task = await insertContentPublishOutbox(tx, site, updated, 'offline', oldPublish.deletePaths, { build: false });
    return { updated, task };
  });
  await enqueueCmsPublishOutboxes([mutation.task], `内容 #${id} 下线`);
  triggerCmsContentWebhook('content.offline', id);
  return options?.skipAccessCheck ? mapCmsContent(mutation.updated) : getCmsContent(id);
}

// ─── 回收站 ───────────────────────────────────────────────────────────────────
async function assertBatchSiteAccess(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  await assertCmsContentsUnlocked(unique);
  const rows = await db.select({
    id: cmsContents.id,
    siteId: cmsContents.siteId,
    channelId: cmsContents.channelId,
  }).from(cmsContents).where(inArray(cmsContents.id, unique));
  assertCompleteCmsBatch(unique, rows.map((row) => row.id), '内容');
  for (const siteId of new Set(rows.map((r) => r.siteId))) {
    await assertSiteAccess(siteId);
  }
  await assertChannelsAccess(rows.map((r) => r.channelId));
}

export async function recycleCmsContents(ids: number[]) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const initial = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId }).from(cmsContents)
    .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt)));
  const mutation = await db.transaction(async (tx) => {
    const sites = new Map<number, typeof cmsSites.$inferSelect>();
    for (const siteId of [...new Set(initial.map((row) => row.siteId))].sort((a, b) => a - b)) {
      sites.set(siteId, await lockCmsSiteForMutation(tx, siteId));
    }
    const locked = await tx.select().from(cmsContents)
      .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
      .for('update');
    const oldSnapshots = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of locked) {
      oldSnapshots.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const rows = await tx.update(cmsContents)
      .set({ deletedAt: new Date(), status: 'offline', version: sql`${cmsContents.version} + 1` })
      .where(and(inArray(cmsContents.id, locked.map((row) => row.id)), isNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
      .returning();
    const refsTasks: AsyncTask[] = [];
    for (const siteId of new Set(rows.filter((row) => row.detailTemplate).map((row) => row.siteId))) {
      const revision = await bumpCmsTemplateRefsRevision(tx, siteId);
      const site = { ...sites.get(siteId)!, templateRefsRevision: revision };
      sites.set(siteId, site);
      refsTasks.push(await insertCmsSiteRefsRebuildOutbox(
        tx,
        site,
        '回收内容模板引用移除',
        `site:${siteId}:refs:${revision}`,
      ));
    }
    await logContentOps(tx, rows.map((row) => ({ id: row.id })), 'recycled');
    const tasks: AsyncTask[] = [];
    for (const row of rows) {
      tasks.push(await insertContentPublishOutbox(
        tx,
        sites.get(row.siteId)!,
        row,
        'recycle',
        oldSnapshots.get(row.id)?.deletePaths ?? [],
        { build: false },
      ));
    }
    return { rows, tasks: [...tasks, ...refsTasks] };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容批量回收');
  for (const row of mutation.rows) triggerCmsContentWebhook('content.recycled', row.id);
  return mutation.rows.length;
}

export async function restoreCmsContents(ids: number[]) {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const initial = await db.select({ siteId: cmsContents.siteId }).from(cmsContents).where(inArray(cmsContents.id, ids));
  const mutation = await db.transaction(async (tx) => {
    const sites = new Map<number, typeof cmsSites.$inferSelect>();
    for (const siteId of [...new Set(initial.map((row) => row.siteId))].sort((a, b) => a - b)) {
      sites.set(siteId, await lockCmsSiteForMutation(tx, siteId));
    }
    const rows = await tx.update(cmsContents)
      .set({ deletedAt: null, status: 'draft' })
      .where(and(inArray(cmsContents.id, ids), isNotNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
      .returning();
    const tasks: AsyncTask[] = [];
    for (const siteId of new Set(rows.filter((row) => row.detailTemplate).map((row) => row.siteId))) {
      const revision = await bumpCmsTemplateRefsRevision(tx, siteId);
      tasks.push(await insertCmsSiteRefsRebuildOutbox(
        tx,
        { ...sites.get(siteId)!, templateRefsRevision: revision },
        '恢复内容模板引用',
        `site:${siteId}:refs:${revision}`,
      ));
    }
    await logContentOps(tx, rows.map((row) => ({ id: row.id })), 'restored');
    return { count: rows.length, tasks };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容恢复');
  return mutation.count;
}

/** 彻底删除（仅限回收站中的内容）；被映射引用的正文先物化到映射行，避免映射内容失源 */
export async function purgeCmsContents(ids: number[], options?: { skipAccessCheck?: boolean }) {
  if (ids.length === 0) return 0;
  if (options?.skipAccessCheck) await assertCmsContentsUnlocked(ids);
  else await assertBatchSiteAccess(ids);
  const targets = await db.select().from(cmsContents)
    .where(and(inArray(cmsContents.id, ids), isNotNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)));
  if (targets.length === 0) return 0;
  const targetIds = targets.map((t) => t.id);
  const mutation = await db.transaction(async (tx) => {
    const sites = new Map<number, typeof cmsSites.$inferSelect>();
    for (const siteId of [...new Set(targets.map((row) => row.siteId))].sort((a, b) => a - b)) {
      sites.set(siteId, await lockCmsSiteForMutation(tx, siteId));
    }
    const lockedTargets = await tx.select().from(cmsContents).where(and(
      inArray(cmsContents.id, targetIds),
      isNotNull(cmsContents.deletedAt),
      isNull(cmsContents.lockedAt),
    )).for('update');
    const captured = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of lockedTargets) {
      captured.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const lockedIds = lockedTargets.map((row) => row.id);
    if (lockedIds.length === 0) return { count: 0, tasks: [] as AsyncTask[] };
    // 物化：把被删来源的正文/扩展字段拷回映射行，映射行转为独立内容
    const mappedRows = await tx.select({ id: cmsContents.id, mappingSourceId: cmsContents.mappingSourceId, lockedAt: cmsContents.lockedAt, lockReason: cmsContents.lockReason })
      .from(cmsContents).where(inArray(cmsContents.mappingSourceId, lockedIds));
    const lockedMapped = mappedRows.find((row) => row.lockedAt);
    if (lockedMapped) throw new HTTPException(423, { message: `映射内容 #${lockedMapped.id} 已被持久锁定${lockedMapped.lockReason ? `：${lockedMapped.lockReason}` : ''}` });
    if (mappedRows.length > 0) {
      const sourceIds = [...new Set(mappedRows.map((m) => m.mappingSourceId!))];
      const sources = await tx.select({ id: cmsContents.id, body: cmsContents.body, extend: cmsContents.extend })
        .from(cmsContents).where(inArray(cmsContents.id, sourceIds));
      const srcById = new Map(sources.map((s) => [s.id, s]));
      for (const m of mappedRows) {
        const src = srcById.get(m.mappingSourceId!);
        await tx.update(cmsContents)
          .set({ body: src?.body ?? null, extend: src?.extend ?? {}, mappingSourceId: null })
          .where(eq(cmsContents.id, m.id));
      }
    }
    await tx.update(cmsCollectItems)
      .set({ contentId: null })
      .where(inArray(cmsCollectItems.contentId, lockedIds));
    const tagRows = await tx.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags)
      .where(inArray(cmsContentTags.contentId, lockedIds));
    await tx.delete(cmsContents).where(inArray(cmsContents.id, lockedIds));
    await recalcTagContentCounts(tx, tagRows.map((t) => t.tagId));
    const refsTasks: AsyncTask[] = [];
    for (const siteId of new Set(lockedTargets.filter((row) => row.detailTemplate).map((row) => row.siteId))) {
      const revision = await bumpCmsTemplateRefsRevision(tx, siteId);
      const site = { ...sites.get(siteId)!, templateRefsRevision: revision };
      sites.set(siteId, site);
      refsTasks.push(await insertCmsSiteRefsRebuildOutbox(
        tx,
        site,
        '彻底删除内容模板引用',
        `site:${siteId}:refs:${revision}`,
      ));
    }
    const tasks: AsyncTask[] = [];
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
    }
    return { count: lockedIds.length, tasks: [...tasks, ...refsTasks] };
  });
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容彻底删除');
  return mutation.count;
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

// ─── 归档（前台详情保留，不参与列表聚合；仅已发布/已下线内容可归档）──────────────
async function setCmsContentsArchived(ids: number[], archived: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const initial = await db.select().from(cmsContents).where(inArray(cmsContents.id, ids));
  const mutation = await db.transaction(async (tx) => {
    const sites = new Map<number, typeof cmsSites.$inferSelect>();
    for (const siteId of [...new Set(initial.map((row) => row.siteId))].sort((a, b) => a - b)) {
      sites.set(siteId, await lockCmsSiteForMutation(tx, siteId));
    }
    const archivedCondition = archived ? isNull(cmsContents.archivedAt) : isNotNull(cmsContents.archivedAt);
    const locked = await tx.select().from(cmsContents).where(and(
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
  return mutation.rows.length;
}

export async function archiveCmsContents(ids: number[]) {
  return setCmsContentsArchived(ids, true);
}

export async function unarchiveCmsContents(ids: number[]) {
  return setCmsContentsArchived(ids, false);
}

// ─── 前台查询（渲染上下文使用）────────────────────────────────────────────────
const publishedWhere = (siteId: number) => and(
  eq(cmsContents.siteId, siteId),
  eq(cmsContents.status, 'published'),
  isNull(cmsContents.deletedAt),
)!;

/** 栏目下已发布内容分页（含以此为副栏目的内容；归档内容不参与聚合；置顶权重优先，发布时间倒序） */
export async function listPublishedContents(siteId: number, channelId: number, page: number, pageSize: number) {
  const extraIdsQuery = db.select({ contentId: cmsContentChannels.contentId })
    .from(cmsContentChannels).where(and(
      eq(cmsContentChannels.channelId, channelId),
    ));
  const where = and(
    publishedWhere(siteId),
    isNull(cmsContents.archivedAt),
    or(eq(cmsContents.channelId, channelId), inArray(cmsContents.id, extraIdsQuery)),
  )!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    withPagination(
      db.select().from(cmsContents).where(where)
        .orderBy(desc(cmsContents.isTop), desc(cmsContents.topWeight), desc(cmsContents.sort), desc(cmsContents.publishedAt), desc(cmsContents.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { total, rows };
}

/** 首页区块：最新 / 推荐 / 热门（归档内容不参与） */
export async function listHomeContents(siteId: number, limit = 10) {
  const base = and(publishedWhere(siteId), isNull(cmsContents.archivedAt))!;
  const [latest, recommended, hot] = await Promise.all([
    db.select().from(cmsContents).where(base).orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id)).limit(limit),
    db.select().from(cmsContents).where(and(base, eq(cmsContents.isRecommend, true))).orderBy(desc(cmsContents.publishedAt)).limit(limit),
    db.select().from(cmsContents).where(and(base, eq(cmsContents.isHot, true))).orderBy(desc(cmsContents.viewCount)).limit(limit),
  ]);
  return { latest, recommended, hot };
}

/** 前台详情（按 id 或 slug）；返回 null 表示 404 */
export async function getPublishedContent(siteId: number, channelId: number, idOrSlug: string): Promise<CmsContentRow | null> {
  const numericId = /^\d+$/.test(idOrSlug) ? Number(idOrSlug) : null;
  const matcher = numericId !== null ? eq(cmsContents.id, numericId) : eq(cmsContents.slug, idOrSlug);
  const [row] = await db.select().from(cmsContents)
    .where(and(publishedWhere(siteId), eq(cmsContents.channelId, channelId), matcher))
    .limit(1);
  return row ?? null;
}

/** 按 id 取站点内已发布内容（不限栏目；Headless API 用） */
export async function getPublishedContentById(siteId: number, id: number): Promise<CmsContentRow | null> {
  const [row] = await db.select().from(cmsContents)
    .where(and(publishedWhere(siteId), eq(cmsContents.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * 解析内容正文/扩展字段（映射内容透传来源行）：
 * 前台详情渲染、草稿预览、Headless API 输出正文前统一经过此函数。
 */
export async function resolveContentBodyExtend(row: Pick<CmsContentRow, 'body' | 'extend' | 'mappingSourceId'>): Promise<{ body: string | null; extend: Record<string, unknown> }> {
  if (!row.mappingSourceId) return { body: row.body ?? null, extend: row.extend ?? {} };
  const [src] = await db.select({ body: cmsContents.body, extend: cmsContents.extend })
    .from(cmsContents).where(and(
      eq(cmsContents.id, row.mappingSourceId),
    )).limit(1);
  return { body: src?.body ?? null, extend: src?.extend ?? {} };
}

/** 上一篇 / 下一篇（同栏目按发布时间序；跳过归档内容） */
export async function getAdjacentContents(row: CmsContentRow) {
  const base = and(publishedWhere(row.siteId), isNull(cmsContents.archivedAt), eq(cmsContents.channelId, row.channelId), ne(cmsContents.id, row.id))!;
  const anchor = row.publishedAt ?? row.createdAt;
  const [prevRows, nextRows] = await Promise.all([
    db.select().from(cmsContents).where(and(base, lt(cmsContents.publishedAt, anchor))).orderBy(desc(cmsContents.publishedAt)).limit(1),
    db.select().from(cmsContents).where(and(base, gt(cmsContents.publishedAt, anchor))).orderBy(asc(cmsContents.publishedAt)).limit(1),
  ]);
  return { prev: prevRows[0] ?? null, next: nextRows[0] ?? null };
}

/**
 * 浏览计数：Redis 缓冲累加（zenith:cms:viewbuf hash），周期任务批量落库，
 * 避免高并发下逐次 UPDATE 行锁排队；Redis 不可用时降级直写 DB。
 */
const VIEW_BUFFER_KEY = `${config.redis.keyPrefix}cms:viewbuf`;

export async function increaseViewCount(id: number): Promise<void> {
  try {
    await redis.hincrby(VIEW_BUFFER_KEY, String(id), 1);
  } catch {
    await db.update(cmsContents)
      .set({ viewCount: sql`${cmsContents.viewCount} + 1` })
      .where(eq(cmsContents.id, id));
  }
}

/** 浏览计数落库（系统周期任务调用，每分钟）：取走缓冲并批量累加 */
export async function flushViewCountBuffer(): Promise<number> {
  const buffer = await redis.hgetall(VIEW_BUFFER_KEY).catch(() => ({} as Record<string, string>));
  const entries = Object.entries(buffer).filter(([, v]) => Number(v) > 0);
  if (entries.length === 0) return 0;
  await redis.del(VIEW_BUFFER_KEY).catch(() => undefined);
  for (const [idText, countText] of entries) {
    const id = Number(idText);
    const count = Number(countText);
    if (!Number.isInteger(id) || !Number.isInteger(count) || count <= 0) continue;
    await db.update(cmsContents)
      .set({ viewCount: sql`${cmsContents.viewCount} + ${count}` })
      .where(eq(cmsContents.id, id));
  }
  return entries.length;
}

/** 内容标签（前台详情页展示） */
export async function listContentTags(contentId: number): Promise<CmsTagRow[]> {
  const rows = await db.query.cmsContentTags.findMany({
    where: eq(cmsContentTags.contentId, contentId),
    with: { tag: true },
  });
  return rows.map((r) => r.tag);
}

/** 详情页相关文章：手动关联优先（按 sort），不足 limit 时按共同标签自动补齐 */
export async function listRelatedContents(row: CmsContentRow, limit = 5): Promise<CmsContentRow[]> {
  const manualRows = await db.query.cmsContentRelations.findMany({
    where: eq(cmsContentRelations.contentId, row.id),
    with: { related: true },
    orderBy: asc(cmsContentRelations.sort),
  });
  const result = manualRows
    .map((r) => r.related)
    .filter((c): c is CmsContentRow => !!c && c.status === 'published' && !c.deletedAt && !c.archivedAt)
    .slice(0, limit);
  if (result.length < limit) {
    const tagIdsQuery = db.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(and(
      eq(cmsContentTags.contentId, row.id),
    ));
    const candidateIdsQuery = db.select({ contentId: cmsContentTags.contentId }).from(cmsContentTags).where(and(
      inArray(cmsContentTags.tagId, tagIdsQuery),
    ));
    const excluded = [row.id, ...result.map((c) => c.id)];
    const fill = await db.select().from(cmsContents)
      .where(and(
        publishedWhere(row.siteId),
        isNull(cmsContents.archivedAt),
        inArray(cmsContents.id, candidateIdsQuery),
        notInArray(cmsContents.id, excluded),
      ))
      .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
      .limit(limit - result.length);
    result.push(...fill);
  }
  return result;
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

/** 过期下线：expireAt 到期的已发布内容自动下线；返回受影响内容 id（供静态刷新） */
export async function offlineExpiredCmsContents(now = new Date()): Promise<number[]> {
  const rows = await db.select({ id: cmsContents.id }).from(cmsContents).where(and(
      isNotNull(cmsContents.expireAt),
      lte(cmsContents.expireAt, now),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.lockedAt),
    ));
  const completed: number[] = [];
  for (const row of rows) {
    try {
      await offlineCmsContent(row.id, { skipAccessCheck: true, expireAtBefore: now });
      completed.push(row.id);
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 409) throw error;
    }
  }
  return completed;
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
    const sites = new Map<number, typeof cmsSites.$inferSelect>();
    for (const siteId of [...new Set(initial.map((row) => row.siteId))].sort((a, b) => a - b)) {
      sites.set(siteId, await lockCmsSiteForMutation(tx, siteId));
    }
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

/** 标签聚合页：按标签取已发布内容分页（归档内容不参与） */
export async function listPublishedContentsByTag(siteId: number, tagId: number, page: number, pageSize: number) {
  const idsQuery = db.select({ contentId: cmsContentTags.contentId }).from(cmsContentTags).where(and(
    eq(cmsContentTags.tagId, tagId),
  ));
  const where = and(publishedWhere(siteId), isNull(cmsContents.archivedAt), inArray(cmsContents.id, idsQuery))!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    withPagination(
      db.select().from(cmsContents).where(where)
        .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { total, rows };
}

/** 批量移动栏目（目标须为本站点列表栏目；重算 modelId；事务保证读写一致） */
export async function batchMoveCmsContents(ids: number[], channelId: number): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  await assertChannelAccess(channelId);
  const mutation = await db.transaction(async (tx) => {
    const rows = await tx.select().from(cmsContents).where(inArray(cmsContents.id, ids));
    assertCompleteCmsBatch(ids, rows.map((row) => row.id), '内容');
    const siteIds = new Set(rows.map((r) => r.siteId));
    if (siteIds.size > 1) throw new HTTPException(400, { message: '仅支持同站点内容批量移动' });
    const siteId = [...siteIds][0];
    if (siteId === undefined) return 0;
    let site = await lockCmsSiteForMutation(tx, siteId);
    const oldSnapshots = new Map<number, Awaited<ReturnType<typeof captureCmsContentPublishSnapshot>>>();
    for (const row of rows.filter((item) => item.status === 'published')) {
      oldSnapshots.set(row.id, await captureCmsContentPublishSnapshot(tx, row, { includeExistingArtifacts: true }));
    }
    const channel = await ensureChannelForContent(siteId, channelId);
    const updated = await tx.update(cmsContents)
      .set({ channelId, modelId: channel.modelId ?? null, version: sql`${cmsContents.version} + 1` })
      .where(and(inArray(cmsContents.id, rows.map((r) => r.id)), isNull(cmsContents.lockedAt)))
      .returning();
    const revision = await bumpCmsTemplateRefsRevision(tx, siteId);
    site = { ...site, templateRefsRevision: revision };
    await logContentOps(tx, updated.map((row) => ({ id: row.id })), 'moved', `移动到栏目「${channel.name}」`);
    const tasks: AsyncTask[] = [];
    for (const row of updated.filter((item) => oldSnapshots.has(item.id))) {
      const old = oldSnapshots.get(row.id)!;
      tasks.push(await insertContentPublishOutbox(tx, site, row, 'move', old.deletePaths, {
        build: true,
        refreshChannelIds: [old.snapshot.channelId, row.channelId],
      }));
    }
    tasks.push(await insertCmsSiteRefsRebuildOutbox(
      tx,
      site,
      '内容跨栏目模板继承更新',
      `site:${siteId}:refs:${revision}`,
    ));
    return { count: updated.length, tasks };
  });
  if (typeof mutation === 'number') return mutation;
  await enqueueCmsPublishOutboxes(mutation.tasks, '内容批量移动');
  return mutation.count;
}

/** 批量设置属性（置顶/推荐/热门，仅更新传入的字段） */
export async function batchSetCmsContentFlags(ids: number[], flags: { isTop?: boolean; isRecommend?: boolean; isHot?: boolean; isOriginal?: boolean }): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const patch: Record<string, boolean> = {};
  if (flags.isTop !== undefined) patch.isTop = flags.isTop;
  if (flags.isRecommend !== undefined) patch.isRecommend = flags.isRecommend;
  if (flags.isHot !== undefined) patch.isHot = flags.isHot;
  if (flags.isOriginal !== undefined) patch.isOriginal = flags.isOriginal;
  if (Object.keys(patch).length === 0) return 0;
  const updated = await db.update(cmsContents).set(patch)
    .where(and(inArray(cmsContents.id, ids), isNull(cmsContents.deletedAt), isNull(cmsContents.lockedAt)))
    .returning({ id: cmsContents.id });
  return updated.length;
}

/** 批量追加标签（跳过已存在的绑定，重算计数） */
export async function batchAddCmsContentTags(ids: number[], tagIds: number[]): Promise<number> {
  if (ids.length === 0 || tagIds.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  const rows = await db.select({
    id: cmsContents.id,
    siteId: cmsContents.siteId,
  }).from(cmsContents).where(inArray(cmsContents.id, ids));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '内容');
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const validTags = await tx.select({ id: cmsTags.id }).from(cmsTags)
        .where(and(inArray(cmsTags.id, tagIds), eq(cmsTags.siteId, row.siteId)));
      assertCompleteCmsBatch(tagIds, validTags.map((tag) => tag.id), '标签');
      await tx.insert(cmsContentTags)
        .values(validTags.map((tag) => ({ contentId: row.id, tagId: tag.id })))
        .onConflictDoNothing();
    }
    await recalcTagContentCounts(tx, tagIds);
  });
  return rows.length;
}

/** 复制内容为草稿（标题加后缀，slug 置空避免唯一冲突，标签一并复制） */
export async function duplicateCmsContent(id: number) {
  const current = await ensureCmsContentExists(id);
  await assertSiteAccess(current.siteId);
  await assertChannelAccess(current.channelId);
  assertCmsContentUnlocked(current);
  const tagRows = await db.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(and(
    eq(cmsContentTags.contentId, id),
  ));
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(cmsContents).values({
      siteId: current.siteId,
      channelId: current.channelId,
      modelId: current.modelId,
      contentType: current.contentType,
      mediaData: current.mediaData ?? {},
      title: `${current.title}（副本）`.slice(0, 255),
      subTitle: current.subTitle,
      shortTitle: current.shortTitle,
      slug: null,
      summary: current.summary,
      coverImage: current.coverImage,
      coverThumb: current.coverThumb,
      author: current.author,
      editor: current.editor,
      source: current.source,
      sourceUrl: current.sourceUrl,
      isOriginal: current.isOriginal,
      body: current.body,
      extend: current.extend ?? {},
      externalLink: current.externalLink,
      isTop: false,
      isRecommend: current.isRecommend,
      isHot: current.isHot,
      status: 'draft',
      sort: current.sort,
      seoTitle: current.seoTitle,
      seoKeywords: current.seoKeywords,
      seoDescription: current.seoDescription,
      searchVector: buildSearchVector({
        siteId: current.siteId,
        title: `${current.title}（副本）`,
        seoKeywords: current.seoKeywords,
        summary: current.summary,
        body: current.body,
      }),
    }).returning();
    if (tagRows.length > 0) {
      await tx.insert(cmsContentTags).values(tagRows.map((t) => ({
        contentId: created.id,
        tagId: t.tagId,
      })));
      await recalcTagContentCounts(tx, tagRows.map((t) => t.tagId));
    }
    await logContentOp(tx, created.id, 'created', `复制自内容 #${current.id}`);
    return created;
  });
  return getCmsContent(row.id);
}

/**
 * 站群内容分发：把内容分发到目标站点栏目（草稿，标签不跨站复制；事务保证全部成功或回滚）。
 * - copy（独立复制，默认）：完整拷贝正文/扩展字段，分发后独立编辑，仅在操作日志记录来源
 * - mapping（映射）：仅拷贝标题等元数据，正文/扩展字段运行时透传来源内容，源改动即时生效；
 *   映射行禁止独立编辑正文；来源被彻底删除时自动物化为独立内容
 */
export async function distributeCmsContents(ids: number[], targetSiteId: number, targetChannelId: number, mode: 'copy' | 'mapping' = 'copy'): Promise<number> {
  if (ids.length === 0) return 0;
  await assertBatchSiteAccess(ids);
  await assertSiteAccess(targetSiteId);
  await assertChannelAccess(targetChannelId);
  await ensureCmsSiteExists(targetSiteId);
  const channel = await ensureChannelForContent(targetSiteId, targetChannelId);
  const rows = await db.select().from(cmsContents).where(inArray(cmsContents.id, ids));
  assertCompleteCmsBatch(ids, rows.map((row) => row.id), '内容');
  return db.transaction(async (tx) => {
    let copied = 0;
    for (const current of rows) {
      if (current.siteId === targetSiteId) continue; // 同站分发无意义，跳过
      // 映射的映射仍指向原始来源，避免形成解析链
      const mappingSourceId = mode === 'mapping' ? (current.mappingSourceId ?? current.id) : null;
      const [created] = await tx.insert(cmsContents).values({
        siteId: targetSiteId,
        channelId: targetChannelId,
        modelId: channel.modelId ?? null,
        contentType: current.contentType,
        mediaData: current.mediaData ?? {},
        title: current.title,
        subTitle: current.subTitle,
        shortTitle: current.shortTitle,
        slug: null,
        summary: current.summary,
        coverImage: current.coverImage,
        coverThumb: current.coverThumb,
        author: current.author,
        editor: current.editor,
        source: current.source,
        sourceUrl: current.sourceUrl,
        isOriginal: current.isOriginal,
        body: mode === 'mapping' ? null : current.body,
        extend: mode === 'mapping' ? {} : (current.extend ?? {}),
        externalLink: current.externalLink,
        mappingSourceId,
        status: 'draft',
        seoTitle: current.seoTitle,
        seoKeywords: current.seoKeywords,
        seoDescription: current.seoDescription,
        // 映射行也按来源正文建检索向量，站内搜索可命中
        searchVector: buildSearchVector({
          siteId: targetSiteId,
          title: current.title,
          seoKeywords: current.seoKeywords,
          summary: current.summary,
          body: current.body,
        }),
      }).returning();
      await logContentOp(tx, created.id, 'created', mode === 'mapping' ? `映射自内容 #${current.id}` : `站群分发复制自内容 #${current.id}`);
      copied += 1;
    }
    return copied;
  });
}

/** 回收站自动清理：彻底删除进入回收站超过 N 天的内容（系统周期任务调用） */
export async function cleanupCmsRecycleBin(retentionDays = 30): Promise<number> {
  const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const targets = await db.select({ id: cmsContents.id }).from(cmsContents)
    .where(and(isNotNull(cmsContents.deletedAt), lt(cmsContents.deletedAt, threshold), isNull(cmsContents.lockedAt)));
  if (targets.length === 0) return 0;
  return purgeCmsContents(targets.map((t) => t.id), { skipAccessCheck: true });
}
