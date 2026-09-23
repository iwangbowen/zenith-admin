import { cmsModelVersions } from '../../db/schema/cms-design';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, desc, and, or, inArray, notInArray, isNull, isNotNull, ne, lt, gt, sql, type SQL } from 'drizzle-orm';
import { db, withoutDbExecutor } from '../../db';
import { withCmsPublicGeneration } from './cms-generation-storage.service';
import { cmsGenerationContext } from './cms-generation-context';
import { cmsContents, cmsContentTags, cmsContentChannels, cmsContentRelations, cmsContentWorkingCopies, cmsChannels, cmsTags } from '../../db/schema';
import type { CmsContentRow, CmsTagRow } from '../../db/schema';
import { formatTimestamps } from '../../lib/datetime';
import { pickEntity } from '../../lib/entity-map';
import { buildWhere, dateRangeConditions, withPagination, keywordCondition } from '../../lib/where-helpers';
import { config } from '../../config';
import redis from '../../lib/redis';
import { getAccessibleChannelIds, assertChannelAccess } from './cms-channels.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { cmsContentContract, cmsContentSchema, type CmsEditorialStatus, type CmsContentRevisionSnapshot, type CmsBodyDocument } from '@zenith/shared/cms';
import { pageOffset } from '../../lib/pagination';
import { resolveCmsContentRow, resolveCmsContentRows } from './cms-resource-refs.service';
import { buildCmsContentUrls } from './cms-urls';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { requireBusinessApprovalInstance } from '../workflow/workflow-business-context.service';
import { cmsContentLinkColumns, cmsContentListColumns } from './cms-content-columns';
import type { CmsContentLinkRow, CmsContentListRow } from './cms-content-columns';
import { cmsContentDataScope, requireCmsContentAccess } from './cms-content-access.service';
import { cmsRevisionToContentRow, getCmsReviewRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';

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
  listFields?: Record<string, unknown>;
}) {
  const { body: _body, extend: _extend, mediaData: _mediaData, ...item } = mapCmsContent({ ...row, body: null }, extra);
  return { ...item, listFields: extra?.listFields ?? {} };
}

/** `mapCmsContent` 不读取 search_vector，列表投影行补上 `body: null` 即可复用同一映射 */
type CmsContentMapRow = Omit<CmsContentRow, 'searchVector'> & { coverThumb?: string | null; editorialStatus?: CmsEditorialStatus; publishedRevisionId?: number | null; submittedRevisionId?: number | null; approvedRevisionId?: number | null; hasUnpublishedChanges?: boolean; bodyDocument?: CmsBodyDocument | null; modelVersionId?: number | null; assetVersions?: Record<string, number> };

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
  return pickEntity(cmsContentSchema, row, {
    editorialStatus: row.editorialStatus ?? 'clean',
    publishedRevisionId: row.publishedRevisionId ?? null,
    submittedRevisionId: row.submittedRevisionId ?? null,
    approvedRevisionId: row.approvedRevisionId ?? null,
    hasUnpublishedChanges: row.hasUnpublishedChanges ?? false,
    channelName: extra?.channelName ?? null,
    mediaData: row.mediaData ?? {},
    titleStyle: row.titleStyle ?? {},
    attachments: row.attachments ?? [],
    extend: row.extend ?? {},
    canonicalUrl: extra?.canonicalUrl ?? null,
    previewUrl: extra?.previewUrl ?? null,
    mappingSourceTitle: extra?.mappingSourceTitle ?? null,
    lockedByName: extra?.lockedByName ?? null,
    coverThumb: row.coverThumb ?? null,
    ...(extra?.tags ? { tags: extra.tags.map(mapCmsTagBrief), tagIds: extra.tags.map((t) => t.id) } : {}),
    ...(extra?.extraChannelIds ? { extraChannelIds: extra.extraChannelIds } : {}),
    ...(extra?.relatedIds ? { relatedIds: extra.relatedIds } : {}),
  });
}

function mapCmsTagBrief(t: CmsTagRow) {
  return { id: t.id, siteId: t.siteId, name: t.name, slug: t.slug, groupName: t.groupName ?? null, contentCount: t.contentCount, ...formatTimestamps(t) };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsContentExists(id: number): Promise<CmsContentRow> {
  return requireFirstRow(db.select().from(cmsContents).where(eq(cmsContents.id, id)).limit(1), '内容不存在');
}

export async function getCmsContent(id: number, options?: { skipAccessCheck?: boolean }) {
  const current = options?.skipAccessCheck ? await ensureCmsContentExists(id) : await requireCmsContentAccess(id);
  return loadAuthorizedCmsContent(current);
}

/** Approval authorization exposes only the frozen subject of this exact round. */
export async function getCmsContentForApproval(id: number, instanceId: number) {
  await requireBusinessApprovalInstance(instanceId, 'cms_content', String(id));
  const revision = await getCmsReviewRevision(id, instanceId);
  return { ...await loadAuthorizedCmsContent(revision.payload, revision.snapshot), revisionId: revision.id, contentHash: revision.hash };
}

async function loadAuthorizedCmsContent(identity: CmsContentRow, revisionSnapshot?: CmsContentRevisionSnapshot) {
  const working = await requireCmsWorkingCopy(db, identity.id);
  const snapshot = revisionSnapshot ?? working.snapshot;
  const content = cmsRevisionToContentRow(identity, snapshot);
  const [site, channel, tags] = await Promise.all([
    ensureCmsSiteExists(identity.siteId),
    db.query.cmsChannels.findFirst({ where: eq(cmsChannels.id, snapshot.channelId), columns: { name: true, path: true, detailPathRule: true } }),
    snapshot.tagIds.length ? db.select().from(cmsTags).where(and(eq(cmsTags.siteId, identity.siteId), inArray(cmsTags.id, snapshot.tagIds))) : Promise.resolve([]),
  ]);
  const resolved = await resolveCmsContentRow(content, site.id);
  const urls = buildCmsContentUrls(resolved, { siteCode: site.code, channelPath: channel?.path, detailPathRule: channel?.detailPathRule });
  const [modelVersion] = snapshot.modelVersionId ? await db.select().from(cmsModelVersions).where(eq(cmsModelVersions.id, snapshot.modelVersionId)).limit(1) : [];
  return { ...mapCmsContent({ ...resolved, version: working.version, updatedAt: working.updatedAt, rejectReason: working.rejectReason,
    editorialStatus: working.editorialStatus, publishedRevisionId: working.publishedRevisionId, submittedRevisionId: working.submittedRevisionId,
    approvedRevisionId: working.approvedRevisionId, hasUnpublishedChanges: working.editorialStatus !== 'clean',
    bodyDocument: snapshot.bodyDocument, modelVersionId: snapshot.modelVersionId, assetVersions: snapshot.assetVersions,
  }, { channelName: channel?.name, ...urls, tags, extraChannelIds: snapshot.extraChannelIds, relatedIds: snapshot.relatedIds }), modelFields: modelVersion?.fields ?? [] };
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
  const scopeCondition = await cmsContentDataScope();
  const workingChannel = sql<number>`(${cmsContentWorkingCopies.snapshot}->>'channelId')::integer`;
  const workingCondition = buildWhere(
    eq(cmsContentWorkingCopies.contentId, cmsContents.id),
    q.calendarFrom || q.calendarTo ? or(...['scheduledAt', 'expireAt', 'dueAt'].map((field) => buildWhere(...dateRangeConditions(sql`nullif(${cmsContentWorkingCopies.snapshot}->>${field}, '')::timestamp`, q.calendarFrom, q.calendarTo)))) : undefined,
    q.channelId ? eq(workingChannel, q.channelId) : undefined,
    accessibleChannelIds !== null ? inArray(workingChannel, accessibleChannelIds) : undefined,
    q.editorialStatus ? eq(cmsContentWorkingCopies.editorialStatus, q.editorialStatus) : undefined,
    q.modelId ? sql`(${cmsContentWorkingCopies.snapshot}->>'modelId')::integer = ${q.modelId}` : undefined,
    q.ownerId ? sql`(${cmsContentWorkingCopies.snapshot}->>'ownerId')::integer = ${q.ownerId}` : undefined,
    q.locale ? sql`${cmsContentWorkingCopies.snapshot}->>'locale' = ${q.locale}` : undefined,
    q.hasUnpublishedChanges !== undefined ? (q.hasUnpublishedChanges ? ne(cmsContentWorkingCopies.editorialStatus, 'clean') : eq(cmsContentWorkingCopies.editorialStatus, 'clean')) : undefined,
    q.tags ? sql`${cmsContentWorkingCopies.snapshot}->'tagIds' @> ${JSON.stringify(q.tags.split(',').map(Number))}::jsonb` : undefined,
    keywordCondition(q.keyword, [sql`${cmsContentWorkingCopies.snapshot}->>'title'`, sql`${cmsContentWorkingCopies.snapshot}->>'author'`], 'ilike'),
    q.isTop !== undefined ? sql`(${cmsContentWorkingCopies.snapshot}->>'isTop')::boolean = ${q.isTop}` : undefined,
    q.isRecommend !== undefined ? sql`(${cmsContentWorkingCopies.snapshot}->>'isRecommend')::boolean = ${q.isRecommend}` : undefined,
    q.isHot !== undefined ? sql`(${cmsContentWorkingCopies.snapshot}->>'isHot')::boolean = ${q.isHot}` : undefined,
  );

  return buildWhere(
    eq(cmsContents.siteId, q.siteId),
    accessibleChannelIds !== null ? inArray(cmsContents.channelId, accessibleChannelIds) : undefined,
    q.deleted ? isNotNull(cmsContents.deletedAt) : isNull(cmsContents.deletedAt),
    !q.deleted ? (q.archived ? isNotNull(cmsContents.archivedAt) : isNull(cmsContents.archivedAt)) : undefined,
    sql`exists (select 1 from ${cmsContentWorkingCopies} where ${workingCondition})`,
    q.status ? eq(cmsContents.status, q.status) : undefined,
    q.contentType ? eq(cmsContents.contentType, q.contentType) : undefined,
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
        columns: { body: false, searchVector: false, extend: false, mediaData: false, attachments: false },
        with: {
          channel: { columns: { name: true, path: true, detailPathRule: true } },
          lockedByUser: { columns: { nickname: true } },
        },
        orderBy: [desc(cmsContents.isTop), desc(cmsContents.topWeight), desc(cmsContents.id)],
        limit: q.pageSize,
        offset: pageOffset(q.page, q.pageSize),
      });
      if (!rows.length) return [];
      const drafts = await db.select({
        contentId: cmsContentWorkingCopies.contentId, version: cmsContentWorkingCopies.version,
        editorialStatus: cmsContentWorkingCopies.editorialStatus, updatedAt: cmsContentWorkingCopies.updatedAt,
        rejectReason: cmsContentWorkingCopies.rejectReason, publishedRevisionId: cmsContentWorkingCopies.publishedRevisionId,
        submittedRevisionId: cmsContentWorkingCopies.submittedRevisionId, approvedRevisionId: cmsContentWorkingCopies.approvedRevisionId,
        snapshot: sql<Omit<CmsContentRevisionSnapshot, 'body' | 'bodyDocument'>>`jsonb_set(
          ${cmsContentWorkingCopies.snapshot} - 'body' - 'bodyDocument' - 'mediaData' - 'attachments', '{extend}',
          coalesce((select jsonb_object_agg(entry.key, entry.value)
            from jsonb_each(coalesce(${cmsContentWorkingCopies.snapshot}->'extend', '{}'::jsonb)) entry
            where exists (select 1 from ${cmsModelVersions} model_version,
              jsonb_array_elements(model_version.fields) field
              where model_version.id = (${cmsContentWorkingCopies.snapshot}->>'modelVersionId')::integer
                and field->>'name' = entry.key and field->>'showInList' = 'true')), '{}'::jsonb))`,
      }).from(cmsContentWorkingCopies).where(inArray(cmsContentWorkingCopies.contentId, rows.map((row) => row.id)));
      const draftMap = new Map(drafts.map((draft) => [draft.contentId, draft]));
      const channels = await db.select().from(cmsChannels).where(inArray(cmsChannels.id, [...new Set(drafts.map((draft) => draft.snapshot.channelId))]));
      const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
      const modelVersionIds = [...new Set(drafts.flatMap((draft) => draft.snapshot.modelVersionId ? [draft.snapshot.modelVersionId] : []))];
      const modelVersions = modelVersionIds.length ? await db.select({ id: cmsModelVersions.id, fields: cmsModelVersions.fields }).from(cmsModelVersions).where(inArray(cmsModelVersions.id, modelVersionIds)) : [];
      const listFieldsByVersion = new Map(modelVersions.map((version) => [version.id, version.fields.filter((field) => field.showInList).map((field) => field.name)]));
      const editorialRows = rows.map((row) => {
        const draft = requireRow(draftMap.get(row.id), '内容缺少工作稿', 409);
        return { ...cmsRevisionToContentRow({ ...row, body: null, searchVector: null, extend: {}, mediaData: {}, attachments: [] }, { ...draft.snapshot, body: null, bodyDocument: null, mediaData: {}, attachments: [] }), body: null,
          version: draft.version, editorialStatus: draft.editorialStatus, publishedRevisionId: draft.publishedRevisionId,
          submittedRevisionId: draft.submittedRevisionId, approvedRevisionId: draft.approvedRevisionId,
          hasUnpublishedChanges: draft.editorialStatus !== 'clean', updatedAt: draft.updatedAt, rejectReason: draft.rejectReason };
      });
      const resolvedRows = await resolveCmsContentRows(editorialRows, q.siteId);
      return resolvedRows.map((row) => {
        const channel = channelMap.get(row.channelId);
        const listFields = Object.fromEntries((listFieldsByVersion.get(row.modelVersionId ?? 0) ?? []).map((name) => [name, row.extend[name]]));
        return mapCmsContentListItem(row, { listFields, channelName: channel?.name, ...buildCmsContentUrls(row, { siteCode: site.code, channelPath: channel?.path, detailPathRule: channel?.detailPathRule }) });
      });
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
    sql`${cmsContentWorkingCopies.snapshot}->>'title' = ${title.trim()}`,
    await cmsContentDataScope(),
    isNull(cmsContents.deletedAt),
    accessibleChannelIds !== null ? inArray(cmsContents.channelId, accessibleChannelIds) : undefined,
    excludeId ? ne(cmsContents.id, excludeId) : undefined,
  );
  const rows = await db.select({ id: cmsContents.id, title: sql<string>`${cmsContentWorkingCopies.snapshot}->>'title'`, status: cmsContents.status, channelId: cmsContents.channelId })
    .from(cmsContents)
    .innerJoin(cmsContentWorkingCopies, eq(cmsContentWorkingCopies.contentId, cmsContents.id))
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
async function query_listPublishedContents(siteId: number, channelId: number, page: number, pageSize: number) {
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
async function query_listHomeContents(siteId: number, limit = 10) {
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
async function query_getPublishedContent(siteId: number, channelId: number, idOrSlug: string): Promise<ResolvedCmsContentRow | null> {
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
async function query_findPublishedContentByStaticPath(
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
async function query_getPublishedContentById(siteId: number, id: number): Promise<ResolvedCmsContentRow | null> {
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
async function query_getAdjacentContents(row: Pick<CmsContentRow, 'id' | 'siteId' | 'channelId' | 'publishedAt' | 'createdAt'>) {
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
  if (cmsGenerationContext()?.candidate) return;
  try {
    await redis.hincrby(VIEW_BUFFER_KEY, String(id), 1);
  } catch {
    await withoutDbExecutor(() => db.execute(sql`update ${cmsContents} set view_count = view_count + 1 where id = ${id}`));
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
async function query_listRelatedContents(row: Pick<CmsContentRow, 'id' | 'siteId'>, limit = 5): Promise<CmsContentLinkRow[]> {
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
async function query_listPublishedContentsByTag(siteId: number, tagId: number, page: number, pageSize: number) {
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

// Public callers share one generation even when invoked from member or interaction services.
export function listPublishedContents(siteId: number, channelId: number, page: number, pageSize: number) {
  return withCmsPublicGeneration(siteId, () => query_listPublishedContents(siteId, channelId, page, pageSize));
}
export function listHomeContents(siteId: number, limit = 10) {
  return withCmsPublicGeneration(siteId, () => query_listHomeContents(siteId, limit));
}
export function getPublishedContent(siteId: number, channelId: number, idOrSlug: string) {
  return withCmsPublicGeneration(siteId, () => query_getPublishedContent(siteId, channelId, idOrSlug));
}
export function findPublishedContentByStaticPath(siteId: number, rawPath: string) {
  return withCmsPublicGeneration(siteId, () => query_findPublishedContentByStaticPath(siteId, rawPath));
}
export function getPublishedContentById(siteId: number, id: number) {
  return withCmsPublicGeneration(siteId, () => query_getPublishedContentById(siteId, id));
}
export function getAdjacentContents(row: Parameters<typeof query_getAdjacentContents>[0]) {
  return withCmsPublicGeneration(row.siteId, () => query_getAdjacentContents(row));
}
export function listRelatedContents(row: Parameters<typeof query_listRelatedContents>[0], limit = 5) {
  return withCmsPublicGeneration(row.siteId, () => query_listRelatedContents(row, limit));
}
export function listPublishedContentsByTag(siteId: number, tagId: number, page: number, pageSize: number) {
  return withCmsPublicGeneration(siteId, () => query_listPublishedContentsByTag(siteId, tagId, page, pageSize));
}
