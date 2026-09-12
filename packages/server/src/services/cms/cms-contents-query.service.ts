import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, desc, and, or, inArray, notInArray, isNull, isNotNull, ne, lt, gt, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents, cmsContentTags, cmsContentChannels, cmsContentRelations } from '../../db/schema';
import type { CmsContentRow, CmsTagRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { buildWhere, dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { config } from '../../config';
import redis from '../../lib/redis';
import { getAccessibleChannelIds, assertChannelAccess } from './cms-channels.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { getDataScopeCondition } from '../../lib/data-scope';
import { currentUserOrNull } from '../../lib/context';
import { CMS_PREVIEW_PREFIX, cmsContentContract } from '@zenith/shared/cms';
import { pageOffset } from '../../lib/pagination';
import { resolveCmsContentRow, resolveCmsContentRows } from './cms-resource-refs.service';
import { buildCmsContentUrls } from './cms-urls';
import { buildCmsLinkResolver, resolveCmsLink } from './cms-link.service';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { cmsContentLinkColumns, cmsContentListColumns } from './cms-content-columns';
import type { CmsContentLinkRow, CmsContentListRow } from './cms-content-columns';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

/**
 * 已解析素材句柄的内容行。
 *
 * `coverThumb` 不再是数据库列，而是由封面素材派生（媒体库选图同样有缩略图，
 * 且替换素材后自动跟随）；正文/形态数据/扩展字段中的 `cms-res://` 也已还原为真实 URL。
 */
export type ResolvedCmsContentRow = CmsContentRow & { coverThumb: string | null };
/** 列表投影（无 body / search_vector / attachments）的已解析行，见 cms-content-columns.ts */
export type ResolvedCmsContentListRow = CmsContentListRow & { coverThumb: string | null };

/** 后台列表项：全行映射去掉正文与两个大 JSONB，与契约 `cmsContentListItemSchema` 对齐 */
export function mapCmsContentListItem(row: Omit<CmsContentMapRow, 'body'>, extra?: {
  channelName?: string | null;
  lockedByName?: string | null;
  canonicalUrl?: string | null;
  previewUrl?: string | null;
}) {
  const { body: _body, extend: _extend, mediaData: _mediaData, ...item } = mapCmsContent({ ...row, body: null }, extra);
  return item;
}

/** `mapCmsContent` 不读取 search_vector，列表投影行补上 `body: null` 即可复用同一映射 */
type CmsContentMapRow = Omit<CmsContentRow, 'searchVector'> & { coverThumb?: string | null };

export function mapCmsContent(row: CmsContentMapRow, extra?: {
  channelName?: string | null;
  tags?: CmsTagRow[];
  extraChannelIds?: number[];
  relatedIds?: number[];
  mappingSourceTitle?: string | null;
  lockedByName?: string | null;
  canonicalUrl?: string | null;
  previewUrl?: string | null;
}) {
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: extra?.channelName ?? null,
    modelId: row.modelId ?? null,
    contentType: row.contentType,
    mediaData: row.mediaData ?? {},
    title: row.title,
    titleStyle: row.titleStyle ?? {},
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
    attachments: row.attachments ?? [],
    extend: row.extend ?? {},
    externalLink: row.externalLink ?? null,
    detailTemplate: row.detailTemplate ?? null,
    staticPath: row.staticPath ?? null,
    canonicalUrl: extra?.canonicalUrl ?? null,
    previewUrl: extra?.previewUrl ?? null,
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
    distributionRuleId: row.distributionRuleId ?? null,
    distributionSourceId: row.distributionSourceId ?? null,
    distributionSourceVersion: row.distributionSourceVersion ?? null,
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
    ...formatTimestamps(row),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsContentExists(id: number): Promise<CmsContentRow> {
  const [row] = await db.select().from(cmsContents).where(eq(cmsContents.id, id)).limit(1);
  return requireRow(row, '内容不存在');
}

/** 只为站点 / 栏目访问断言取归属列，不解压正文（`getCmsContent` 随后会带关联取全行） */
async function ensureCmsContentOwnership(id: number): Promise<Pick<CmsContentRow, 'id' | 'siteId' | 'channelId'>> {
  const [row] = await db.select({ id: cmsContents.id, siteId: cmsContents.siteId, channelId: cmsContents.channelId })
    .from(cmsContents).where(eq(cmsContents.id, id)).limit(1);
  return requireRow(row, '内容不存在');
}

export async function getCmsContent(id: number) {
  const current = await ensureCmsContentOwnership(id);
  await assertSiteAccess(current.siteId);
  const site = await ensureCmsSiteExists(current.siteId);
  await assertChannelAccess(current.channelId);
  const row = await db.query.cmsContents.findFirst({
    where: eq(cmsContents.id, id),
    with: {
      channel: { columns: { name: true, path: true, detailPathRule: true } },
     contentTags: { with: { tag: true } },
     extraChannels: { columns: { channelId: true } },
     relatedContents: { columns: { relatedId: true, sort: true } },
     lockedByUser: { columns: { nickname: true } },
   },
 });
  const content = requireRow(row, '内容不存在');
  // Mapping rows are materialized snapshots. Never read body/extend from a
  // relation that could belong to another site; only expose a same-site
  // source title for governance UI.
  const [mappingSource] = content.mappingSourceId
    ? await db.select({ title: cmsContents.title }).from(cmsContents).where(and(
      eq(cmsContents.id, content.mappingSourceId),
      eq(cmsContents.siteId, site.id),
    )).limit(1)
    : [null];
  const resolved = await resolveCmsContentRow(content, site.id);
  const urls = buildCmsContentUrls(resolved, {
    siteCode: site.code,
    channelPath: content.channel?.path,
    detailPathRule: content.channel?.detailPathRule,
  });
  if (resolved.externalLink) {
    const [canonicalLink, previewLink] = await Promise.all([
      resolveCmsLink(site.id, '', resolved.externalLink),
      resolved.status === 'published'
        ? resolveCmsLink(site.id, `${CMS_PREVIEW_PREFIX}/${site.code}`, resolved.externalLink)
        : null,
    ]);
    urls.canonicalUrl = canonicalLink?.url ?? null;
    urls.previewUrl = previewLink?.url ?? null;
  }
  return mapCmsContent(resolved, {
    channelName: content.channel?.name,
    ...urls,
    tags: content.contentTags.map((ct) => ct.tag),
    extraChannelIds: content.extraChannels.map((ec) => ec.channelId),
    relatedIds: [...content.relatedContents].sort((a, b) => a.sort - b.sort).map((r) => r.relatedId),
    mappingSourceTitle: mappingSource?.title ?? null,
    lockedByName: content.lockedByUser?.nickname ?? null,
  });
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export type CmsContentListFilter = Omit<QueryOutputOf<typeof cmsContentContract.list>, 'page' | 'pageSize'>;

/**
 * 后台内容列表与导出中心共用的访问条件 + 页面筛选：
 * 站点 / 栏目访问断言、可见栏目集合（非管理员无授权栏目时为空集 → 不返回任何行）、数据范围，再叠加筛选字段。
 * 两边只在这里维护一份，避免导出侧自行拼装出更宽松的栏目可见性。
 */
export async function buildCmsContentListWhere(q: CmsContentListFilter): Promise<SQL | undefined> {
  await assertSiteAccess(q.siteId);
  if (q.channelId) await assertChannelAccess(q.channelId);
  const accessibleChannelIds = await getAccessibleChannelIds();
  const scopeUser = currentUserOrNull();
  const scopeCondition = scopeUser
    ? await getDataScopeCondition({
      currentUserId: scopeUser.userId,
      deptColumn: cmsContents.deptId,
      ownerColumn: cmsContents.createdBy,
    })
    : undefined;

  return buildWhere(
    eq(cmsContents.siteId, q.siteId),
    accessibleChannelIds !== null ? inArray(cmsContents.channelId, accessibleChannelIds) : undefined,
    q.deleted ? isNotNull(cmsContents.deletedAt) : isNull(cmsContents.deletedAt),
    !q.deleted ? (q.archived ? isNotNull(cmsContents.archivedAt) : isNull(cmsContents.archivedAt)) : undefined,
    q.channelId ? eq(cmsContents.channelId, q.channelId) : undefined,
    q.status ? eq(cmsContents.status, q.status) : undefined,
    q.contentType ? eq(cmsContents.contentType, q.contentType) : undefined,
    q.isTop !== undefined ? eq(cmsContents.isTop, q.isTop) : undefined,
    q.isRecommend !== undefined ? eq(cmsContents.isRecommend, q.isRecommend) : undefined,
    q.isHot !== undefined ? eq(cmsContents.isHot, q.isHot) : undefined,
    keywordCondition(q.keyword, [cmsContents.title, cmsContents.author]),
    ...dateRangeConditions(cmsContents.createdAt, q.startTime, q.endTime),
    scopeCondition,
  );
}

export async function listCmsContents(q: QueryOutputOf<typeof cmsContentContract.list>) {
  const site = await ensureCmsSiteExists(q.siteId);
  const where = await buildCmsContentListWhere(q);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsContents, where),
    rows: async () => {
      const rows = await db.query.cmsContents.findMany({
        where,
        // 列表不输出正文与检索向量（两个最大的 TOAST 列）；attachments 保留给列表的附件计数角标
        columns: { body: false, searchVector: false },
        with: {
          channel: { columns: { name: true, path: true, detailPathRule: true } },
          lockedByUser: { columns: { nickname: true } },
        },
        orderBy: [desc(cmsContents.isTop), desc(cmsContents.topWeight), desc(cmsContents.id)],
        limit: q.pageSize,
        offset: pageOffset(q.page, q.pageSize),
      });
      const resolvedRows = await resolveCmsContentRows(rows, q.siteId);
      const [canonicalLinkResolver, previewLinkResolver] = await Promise.all([
        buildCmsLinkResolver(q.siteId, '', resolvedRows.map((row) => row.externalLink)),
        buildCmsLinkResolver(q.siteId, `${CMS_PREVIEW_PREFIX}/${site.code}`, resolvedRows.map((row) => row.externalLink)),
      ]);
      return resolvedRows.map((r) => mapCmsContentListItem(r, {
        channelName: r.channel?.name,
        ...(() => {
          const urls = buildCmsContentUrls(r, {
          siteCode: site.code,
          channelPath: r.channel?.path,
          detailPathRule: r.channel?.detailPathRule,
          });
          if (r.externalLink) {
            urls.canonicalUrl = canonicalLinkResolver(r.externalLink)?.url ?? null;
            urls.previewUrl = r.status === 'published' ? previewLinkResolver(r.externalLink)?.url ?? null : null;
          }
          return urls;
        })(),
        lockedByName: r.lockedByUser?.nickname ?? null,
      }));
    },
  });
}

// ─── 标题查重（P4：编辑辅助提示，不阻断保存；排除回收站与自身）───────────────────
export async function checkCmsContentTitle(siteId: number, title: string, excludeId?: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const accessibleChannelIds = await getAccessibleChannelIds();
  const where = buildWhere(
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.title, title.trim()),
    isNull(cmsContents.deletedAt),
    accessibleChannelIds !== null ? inArray(cmsContents.channelId, accessibleChannelIds) : undefined,
    excludeId ? ne(cmsContents.id, excludeId) : undefined,
  );
  const rows = await db.select({ id: cmsContents.id, title: cmsContents.title, status: cmsContents.status, channelId: cmsContents.channelId })
    .from(cmsContents)
    .where(where)
    .orderBy(desc(cmsContents.id))
    .limit(5);
  return {
    duplicate: rows.length > 0,
    matches: rows.map((r) => ({ id: r.id, title: r.title, status: r.status })),
  };
}

// ─── 前台查询（渲染上下文使用）────────────────────────────────────────────────
const publishedWhere = (siteId: number) => and(
  eq(cmsContents.siteId, siteId),
  eq(cmsContents.status, 'published'),
  isNull(cmsContents.deletedAt),
  // 过期内容即使调度 worker 尚未运行也不能继续出现在任何公开查询中。
  or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
)!;

/** 栏目下已发布内容分页（含以此为副栏目的内容；归档内容不参与聚合；置顶权重优先，发布时间倒序） */
export async function listPublishedContents(siteId: number, channelId: number, page: number, pageSize: number) {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  if (!effectiveChannelIds.has(channelId)) return { total: 0, rows: [] as ResolvedCmsContentListRow[] };
  const extraIdsQuery = db.select({ contentId: cmsContentChannels.contentId })
    .from(cmsContentChannels).where(and(
      eq(cmsContentChannels.channelId, channelId),
    ));
  // 目标栏目已在上面确认为有效栏目，「有效栏目」约束只需落在副栏目聚合分支（内容自身主栏目必须有效）；
  // 若把 channel_id IN (全部有效栏目) 放在外层 AND，规划器会以全站栏目驱动扫描、逐行过滤到本栏目，
  // 堆块访问量随站点总内容数而非栏目内容数增长。
  const where = and(
    publishedWhere(siteId),
    isNull(cmsContents.archivedAt),
    or(
      eq(cmsContents.channelId, channelId),
      and(inArray(cmsContents.id, extraIdsQuery), inArray(cmsContents.channelId, [...effectiveChannelIds])),
    ),
  )!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    withPagination(
      db.select(cmsContentListColumns).from(cmsContents).where(where)
        .orderBy(desc(cmsContents.isTop), desc(cmsContents.topWeight), desc(cmsContents.sort), desc(cmsContents.publishedAt), desc(cmsContents.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { total, rows: await resolveCmsContentRows(rows, siteId) };
}

/** 首页区块：最新 / 推荐 / 热门（归档内容不参与）；三组行合并做一次素材解析（内容大量重叠，素材 id 只查一遍） */
export async function listHomeContents(siteId: number, limit = 10) {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  if (effectiveChannelIds.size === 0) return { latest: [] as ResolvedCmsContentListRow[], recommended: [] as ResolvedCmsContentListRow[], hot: [] as ResolvedCmsContentListRow[] };
  const base = and(publishedWhere(siteId), isNull(cmsContents.archivedAt), inArray(cmsContents.channelId, [...effectiveChannelIds]))!;
  const [latest, recommended, hot] = await Promise.all([
    db.select(cmsContentListColumns).from(cmsContents).where(base).orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id)).limit(limit),
    db.select(cmsContentListColumns).from(cmsContents).where(and(base, eq(cmsContents.isRecommend, true))).orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id)).limit(limit),
    db.select(cmsContentListColumns).from(cmsContents).where(and(base, eq(cmsContents.isHot, true))).orderBy(desc(cmsContents.viewCount), desc(cmsContents.id)).limit(limit),
  ]);
  const resolved = await resolveCmsContentRows([...latest, ...recommended, ...hot], siteId);
  return {
    latest: resolved.slice(0, latest.length),
    recommended: resolved.slice(latest.length, latest.length + recommended.length),
    hot: resolved.slice(latest.length + recommended.length),
  };
}

/** 前台详情（按 id 或 slug）；返回 null 表示 404 */
export async function getPublishedContent(siteId: number, channelId: number, idOrSlug: string): Promise<ResolvedCmsContentRow | null> {
  if (!(await getEffectivelyEnabledCmsChannelIds(siteId)).has(channelId)) return null;
  const numericId = /^\d+$/.test(idOrSlug) ? Number(idOrSlug) : null;
  const matcher = numericId !== null ? eq(cmsContents.id, numericId) : eq(cmsContents.slug, idOrSlug);
  const [row] = await db.select().from(cmsContents)
    .where(and(publishedWhere(siteId), eq(cmsContents.channelId, channelId), matcher))
    .limit(1);
  return row ? resolveCmsContentRow(row, siteId) : null;
}

/**
 * Resolve a published content by its custom static path.
 *
 * The normal detail parser can only infer a content slug/id from a channel
 * path. A custom path deliberately has no such relationship, so it must be
 * looked up exactly (including body-page suffixes) before the generic parser
 * runs. The returned row is intentionally raw; renderDetailPage performs the
 * same resource resolution as every other detail request.
 */
export async function findPublishedContentByStaticPath(
  siteId: number,
  rawPath: string,
): Promise<{ content: CmsContentRow; bodyPage: number } | null> {
  const path = rawPath.replace(/^\/+|\/+$/g, '');
  if (!path || !path.endsWith('.html')) return null;

  const find = async (staticPath: string) => {
    const [row] = await db.select().from(cmsContents).where(and(
      eq(cmsContents.siteId, siteId),
      eq(cmsContents.staticPath, staticPath),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
    )).limit(1);
    return row ?? null;
  };

  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  const direct = await find(path);
  if (direct && !effectiveChannelIds.has(direct.channelId)) return null;
  if (direct) return direct.externalLink?.trim() ? null : { content: direct, bodyPage: 1 };

  const pageMatch = /^(.*)_(\d+)\.html$/.exec(path);
  const bodyPage = pageMatch ? Number(pageMatch[2]) : 0;
  if (!pageMatch || !Number.isInteger(bodyPage) || bodyPage < 2) return null;
  const base = `${pageMatch[1]}.html`;
  const content = await find(base);
  if (!content || content.externalLink?.trim() || !effectiveChannelIds.has(content.channelId)) return null;
  return { content, bodyPage };
}

/** 按 id 取站点内已发布内容（不限栏目；Headless API 用） */
export async function getPublishedContentById(siteId: number, id: number): Promise<ResolvedCmsContentRow | null> {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  if (effectiveChannelIds.size === 0) return null;
  const [row] = await db.select().from(cmsContents)
    .where(and(publishedWhere(siteId), inArray(cmsContents.channelId, [...effectiveChannelIds]), eq(cmsContents.id, id)))
    .limit(1);
  return row ? resolveCmsContentRow(row, siteId) : null;
}

/**
 * 取内容的正文/扩展字段原始值（映射内容透传来源行），**保留 `cms-res://` 句柄**。
 *
 * 站群分发等「内容到内容」的复制场景要用这个：保留句柄意味着跨站引用仍被引用索引记录，
 * 来源站点删除素材时会被删除保护拦下；若写入解析后的绝对 URL，目标站的引用关系就断了。
 */
export async function getContentBodyExtendRaw(
  row: Pick<CmsContentRow, 'body' | 'extend' | 'mappingSourceId'> & { siteId?: number },
): Promise<{ body: string | null; extend: Record<string, unknown> }> {
  // Mapping rows are materialized snapshots. The relationship is metadata for
  // governance/synchronization only; render and API reads never dereference it.
  return { body: row.body ?? null, extend: row.extend ?? {} };
}

/**
 * 解析内容正文/扩展字段（映射内容透传来源行）：
 * 前台详情渲染、草稿预览、Headless API 输出正文前统一经过此函数。
 *
 * 输出同时完成素材句柄 → URL 的解析，调用方拿到的即是可直接渲染的正文。
 */
export async function resolveContentBodyExtend(
  row: Pick<CmsContentRow, 'body' | 'extend' | 'mappingSourceId'> & { siteId?: number },
  siteId: number,
): Promise<{ body: string | null; extend: Record<string, unknown> }> {
  const raw = await getContentBodyExtendRaw(row);
  const [resolved] = await resolveCmsContentRows([{ coverImage: null, body: raw.body, extend: raw.extend }], siteId);
  return { body: resolved.body ?? null, extend: (resolved.extend ?? {}) as Record<string, unknown> };
}

/** 上一篇 / 下一篇（同栏目按发布时间序；跳过归档内容）：只取拼「标题 + 链接」所需的列 */
export async function getAdjacentContents(row: Pick<CmsContentRow, 'id' | 'siteId' | 'channelId' | 'publishedAt' | 'createdAt'>) {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(row.siteId);
  if (!effectiveChannelIds.has(row.channelId)) return { prev: null as CmsContentLinkRow | null, next: null as CmsContentLinkRow | null };
  const base = and(publishedWhere(row.siteId), isNull(cmsContents.archivedAt), inArray(cmsContents.channelId, [...effectiveChannelIds]), eq(cmsContents.channelId, row.channelId), ne(cmsContents.id, row.id))!;
  const anchor = row.publishedAt ?? row.createdAt;
  const [prevRows, nextRows] = await Promise.all([
    db.select(cmsContentLinkColumns).from(cmsContents).where(and(base, lt(cmsContents.publishedAt, anchor))).orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id)).limit(1),
    db.select(cmsContentLinkColumns).from(cmsContents).where(and(base, gt(cmsContents.publishedAt, anchor))).orderBy(asc(cmsContents.publishedAt), asc(cmsContents.id)).limit(1),
  ]);
  return { prev: prevRows[0] ?? null, next: nextRows[0] ?? null };
}

/**
 * 浏览计数：Redis 缓冲累加（zenith:cms:viewbuf hash），周期任务批量落库，
 * 避免高并发下逐次 UPDATE 行锁排队；Redis 不可用时降级直写 DB。
 */
const VIEW_BUFFER_KEY = `${config.redis.keyPrefix}cms:viewbuf`;

/** 单条批量 UPDATE 的最大行数（每行 2 个绑定参数，远低于 PG 的 65535 上限） */
const VIEW_FLUSH_CHUNK = 5000;

export async function increaseViewCount(id: number): Promise<void> {
  try {
    await redis.hincrby(VIEW_BUFFER_KEY, String(id), 1);
  } catch {
    await db.execute(sql`update ${cmsContents} set view_count = view_count + 1 where id = ${id}`);
  }
}

/** 浏览计数落库（系统周期任务调用，每分钟）：取走缓冲并批量累加 */
export async function flushViewCountBuffer(): Promise<number> {
  const buffer = await redis.hgetall(VIEW_BUFFER_KEY).catch(() => ({} as Record<string, string>));
  const entries = Object.entries(buffer).filter(([, v]) => Number(v) > 0);
  if (entries.length === 0) return 0;
  await redis.del(VIEW_BUFFER_KEY).catch(() => undefined);
  const deltas = entries
    .map(([idText, countText]) => ({ id: Number(idText), count: Number(countText) }))
    .filter((d) => Number.isInteger(d.id) && Number.isInteger(d.count) && d.count > 0);
  // 单条 UPDATE ... FROM (VALUES ...) 累加全部增量，替代逐条 UPDATE。
  // 浏览计数是运行统计，不属于公开内容版本；不要触碰 updated_at，
  // 否则静态产物会因每次访问被判为过期。分片提交仍必要：单条语句的
  // 绑定参数上限为 65535（每行 2 个），且此处的行数由
  //    真实访问量决定；缓冲已在上面 del 掉，一次性超限抛错会丢掉整个窗口的计数
  for (let i = 0; i < deltas.length; i += VIEW_FLUSH_CHUNK) {
    const chunk = deltas.slice(i, i + VIEW_FLUSH_CHUNK);
    const values = sql.join(chunk.map((d) => sql`(${d.id}::int, ${d.count}::int)`), sql`, `);
    await db.execute(sql`
      update ${cmsContents} as c
      set view_count = c.view_count + delta.view_delta
      from (values ${values}) as delta(id, view_delta)
      where c.id = delta.id
    `);
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

/** 详情页相关文章：手动关联优先（按 sort），不足 limit 时按共同标签自动补齐；只取拼「标题 + 链接」所需的列 */
export async function listRelatedContents(row: Pick<CmsContentRow, 'id' | 'siteId'>, limit = 5): Promise<CmsContentLinkRow[]> {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(row.siteId);
  if (effectiveChannelIds.size === 0) return [];
  const visible = and(publishedWhere(row.siteId), isNull(cmsContents.archivedAt), inArray(cmsContents.channelId, [...effectiveChannelIds]))!;
  const result: CmsContentLinkRow[] = await db.select(cmsContentLinkColumns)
    .from(cmsContentRelations)
    .innerJoin(cmsContents, eq(cmsContentRelations.relatedId, cmsContents.id))
    .where(and(eq(cmsContentRelations.contentId, row.id), visible))
    .orderBy(asc(cmsContentRelations.sort), asc(cmsContents.id))
    .limit(limit);
  if (result.length < limit) {
    const tagIdsQuery = db.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags).where(and(
      eq(cmsContentTags.contentId, row.id),
    ));
    const candidateIdsQuery = db.select({ contentId: cmsContentTags.contentId }).from(cmsContentTags).where(and(
      inArray(cmsContentTags.tagId, tagIdsQuery),
    ));
    const excluded = [row.id, ...result.map((c) => c.id)];
    const fill = await db.select(cmsContentLinkColumns).from(cmsContents)
      .where(and(
        visible,
        inArray(cmsContents.id, candidateIdsQuery),
        notInArray(cmsContents.id, excluded),
      ))
      .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
      .limit(limit - result.length);
    result.push(...fill);
  }
  return result;
}

/** 标签聚合页：按标签取已发布内容分页（归档内容不参与） */
export async function listPublishedContentsByTag(siteId: number, tagId: number, page: number, pageSize: number) {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  if (effectiveChannelIds.size === 0) return { total: 0, rows: [] as ResolvedCmsContentListRow[] };
  const idsQuery = db.select({ contentId: cmsContentTags.contentId }).from(cmsContentTags).where(and(
    eq(cmsContentTags.tagId, tagId),
  ));
  const where = and(publishedWhere(siteId), isNull(cmsContents.archivedAt), inArray(cmsContents.channelId, [...effectiveChannelIds]), inArray(cmsContents.id, idsQuery))!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, where),
    withPagination(
      db.select(cmsContentListColumns).from(cmsContents).where(where)
        .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { total, rows: await resolveCmsContentRows(rows, siteId) };
}
