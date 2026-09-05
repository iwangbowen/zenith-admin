/**
 * Headless 开放 API 的 CMS 读取服务。
 *
 * 与后台/前台读取路径共用同一批「已发布内容」查询与素材句柄解析，
 * 因此站点权限、映射透传、素材替换等语义天然一致 —— 这里只负责按开放 API 的
 * 查询 DSL 收窄条件、裁剪字段与生成游标。
 *
 * 安全约束：只读已发布、未回收、未归档、所属栏目启用中的内容。
 */
import { and, asc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsChannels, cmsContentChannels, cmsContentRelations, cmsContents, cmsContentTags, cmsModelFields,
  cmsContentTombstones, cmsModels, cmsTags,
} from '../../db/schema';
import type { CmsContentRow, CmsSiteRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import {
  encodeCmsOpenCursor, OpenQueryError, pickCmsOpenFields,
  type CmsOpenSortRule, type ParsedCmsOpenQuery,
} from '../../lib/open-query';
import { CMS_OPEN_SYNC_PAGE_SIZE_MAX, isValidCmsAssetUrl } from '@zenith/shared/cms';
import { resolveCmsContentRows } from './cms-resource-refs.service';
import { contentUrl } from './cms-urls';
import { buildCmsSearchCondition } from './cms-search.service';
import { isCmsContentPubliclyVisible } from './cms-content-state';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { buildCmsLinkResolver } from './cms-link.service';
import type { CmsLinkResolver } from './cms-link.service';

const SORT_COLUMNS = {
  publishedAt: cmsContents.publishedAt,
  createdAt: cmsContents.createdAt,
  updatedAt: cmsContents.updatedAt,
  sort: cmsContents.sort,
  topWeight: cmsContents.topWeight,
  viewCount: cmsContents.viewCount,
  likeCount: cmsContents.likeCount,
  favoriteCount: cmsContents.favoriteCount,
  id: cmsContents.id,
} as const;

/** 已发布且对外可见：排除回收站、归档与停用栏目下的内容 */
function publicWhere(siteId: number): SQL {
  return and(
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    // 与公开 SSR/静态列表保持一致：到期时间是公开可见性的硬条件，
    // 即使定时下线 worker 尚未执行也不得继续通过 Headless API 暴露。
    or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
  )!;
}

async function resolveChannelIds(siteId: number, codes: string[]): Promise<number[]> {
  if (codes.length === 0) return [];
  const rows = await db.select({ id: cmsChannels.id, code: cmsChannels.code }).from(cmsChannels).where(and(
    eq(cmsChannels.siteId, siteId),
    eq(cmsChannels.status, 'enabled'),
    inArray(cmsChannels.code, codes),
  ));
  const enabledIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  const visibleRows = rows.filter((row) => enabledIds.has(row.id));
  const found = new Set(visibleRows.map((row) => row.code));
  const missing = codes.filter((code) => !found.has(code));
  if (missing.length > 0) throw new HTTPException(404, { message: `栏目标识不存在：${missing.join(', ')}` });
  return visibleRows.map((row) => row.id);
}

async function resolveChannelPathIds(siteId: number, path: string): Promise<number[]> {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return [];
  const rows = await db.select({ id: cmsChannels.id, path: cmsChannels.path }).from(cmsChannels).where(and(
    eq(cmsChannels.siteId, siteId),
    eq(cmsChannels.status, 'enabled'),
    or(eq(cmsChannels.path, normalized), keywordCondition(`${normalized}/`, [cmsChannels.path], 'like', 'prefix'))!,
  ));
  const enabledIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  const visibleRows = rows.filter((row) => enabledIds.has(row.id));
  if (visibleRows.length === 0) throw new HTTPException(404, { message: `栏目路径不存在：${path}` });
  return visibleRows.map((row) => row.id);
}

async function resolveTagIds(siteId: number, slugs: string[]): Promise<number[]> {
  if (slugs.length === 0) return [];
  const rows = await db.select({ id: cmsTags.id, slug: cmsTags.slug }).from(cmsTags).where(and(
    eq(cmsTags.siteId, siteId),
    inArray(cmsTags.slug, slugs),
  ));
  const found = new Set(rows.map((row) => row.slug));
  const missing = slugs.filter((slug) => !found.has(slug));
  if (missing.length > 0) throw new HTTPException(404, { message: `标签不存在：${missing.join(', ')}` });
  return rows.map((row) => row.id);
}

/**
 * 扩展字段过滤：只允许模型中标记为 `searchable` 的字段。
 *
 * 否则外部应用可以用任意 JSONB 路径探测未公开的扩展字段（如内部备注、成本价）。
 */
async function buildExtendConditions(
  siteId: number,
  filters: { field: string; value: string }[],
): Promise<SQL[]> {
  if (filters.length === 0) return [];
  const models = await db.select({ id: cmsModels.id }).from(cmsModels).where(or(
    isNull(cmsModels.ownerSiteId),
    eq(cmsModels.ownerSiteId, siteId),
  ));
  const allowed = new Set<string>();
  if (models.length > 0) {
    const fields = await db.select({ name: cmsModelFields.name, searchable: cmsModelFields.searchable })
      .from(cmsModelFields).where(inArray(cmsModelFields.modelId, models.map((model) => model.id)));
    for (const field of fields) if (field.searchable) allowed.add(field.name);
  }
  return filters.map((filter) => {
    if (!allowed.has(filter.field)) {
      throw new HTTPException(400, { message: `扩展字段「${filter.field}」不可用于过滤（需在内容模型中标记为「纳入检索」）` });
    }
    return sql`${cmsContents.extend} ->> ${filter.field} = ${filter.value}`;
  });
}

/** 时间型排序字段：PG 侧是微秒精度，游标必须按微秒比较 */
const TIME_SORT_FIELDS = new Set<CmsOpenSortRule['field']>(['publishedAt', 'createdAt', 'updatedAt']);

/** 时间列 → 微秒整数（文本返回，避免 bigint 精度在驱动层被截断） */
const microsOf = (column: PgColumn) => sql<string>`((extract(epoch from ${column}) * 1000000)::bigint)::text`;

/** 微秒 → 与 timestamp 列同基准的 UTC 墙钟时间 */
const microsToTimestamp = (micros: number) => sql`(to_timestamp(${micros} / 1000000.0) at time zone 'UTC')`;

/**
 * ORDER BY 一律 `NULLS LAST`。
 *
 * PG 的缺省是 desc → NULLS FIRST、asc → NULLS LAST，两个方向不一致，
 * keyset 条件没法用同一套「空值组恒在尾部」的推进逻辑；显式写死后
 * `cursorCondition` 的空值分支对两个方向都成立。
 */
function orderByOf(rules: CmsOpenSortRule[]) {
  return rules.map((rule) => sql`${SORT_COLUMNS[rule.field]} ${sql.raw(rule.direction)} nulls last`);
}

/** 主排序字段的游标值（时间列取**微秒**时间戳，见 TIME_SORT_FIELDS） */
function cursorValueOf(row: CmsContentRow, field: CmsOpenSortRule['field']): number | null {
  const value = (row as unknown as Record<string, unknown>)[field];
  if (value == null) return null;
  if (value instanceof Date) return value.getTime() * 1000;
  return Number(value);
}

/**
 * keyset 条件：`(主排序字段, id)` 严格大于/小于游标。
 *
 * **仅支持「单个排序字段 + id 兜底」**：多字段排序时 ORDER BY 是字典序，而这里只比较主字段，
 * 中间字段被忽略会同时造成重复行与漏行（例如 `-topWeight,-publishedAt` 下 topWeight 几乎全为 0，
 * 整个结果集是一个并列组，游标却只按 id 过滤）。多字段排序在 `assertCursorSortable` 处提前拒绝。
 *
 * 时间列按**微秒**比较：PG 的 `timestamp` 是微秒精度而 JS `Date` 只到毫秒，
 * 用毫秒边界会让 desc 漏掉 `[边界, 真实值)` 区间的行、asc 把游标行自己重新纳入（同一时刻多行时直接死循环）。
 */
function cursorCondition(rules: CmsOpenSortRule[], cursor: { value: number | null; id: number }): SQL {
  const primary = rules[0];
  const column = SORT_COLUMNS[primary.field];
  const idColumn = cmsContents.id;
  // id 用它自己的方向，而不是主字段的方向：sort=-publishedAt,+id 时两者不一致
  const idRule = rules.find((rule) => rule.field === 'id') ?? primary;
  const idAfter = idRule.direction === 'desc' ? lt(idColumn, cursor.id) : gt(idColumn, cursor.id);

  if (primary.field === 'id') return idAfter;

  const bound = cursor.value == null
    ? null
    : (TIME_SORT_FIELDS.has(primary.field) ? microsToTimestamp(cursor.value) : sql`${cursor.value}`);

  if (bound == null) {
    // 主排序值为 null：空值组恒在尾部（orderBy 强制 nulls last），只能继续在组内按 id 推进
    return and(isNull(column), idAfter)!;
  }
  const strictly = primary.direction === 'desc' ? lt(column, bound) : gt(column, bound);
  const tie = and(eq(column, bound), idAfter);
  // 空值组排在所有有值行之后，翻页要能跨过边界进入该组
  return or(strictly, tie, isNull(column))!;
}

/**
 * 游标翻页要求排序可被 keyset 表达：至多一个非 id 排序字段。
 *
 * 与其在多字段排序下悄悄给出重复/缺失的结果，不如直接告诉调用方换用 page 模式。
 */
function assertCursorSortable(rules: CmsOpenSortRule[]): void {
  const nonId = rules.filter((rule) => rule.field !== 'id');
  if (nonId.length > 1) {
    throw new HTTPException(400, {
      message: `游标翻页仅支持单个排序字段（当前为 ${nonId.map((r) => r.field).join(', ')}），请改用 page 分页或只保留一个排序字段`,
    });
  }
}

async function buildListConditions(site: CmsSiteRow, query: ParsedCmsOpenQuery): Promise<SQL[]> {
  const conditions: SQL[] = [publicWhere(site.id)];
  const effectivelyEnabledIds = await getEffectivelyEnabledCmsChannelIds(site.id);
  if (effectivelyEnabledIds.size === 0) {
    conditions.push(sql`false`);
  } else {
    conditions.push(inArray(cmsContents.channelId, [...effectivelyEnabledIds]));
  }

  const channelIds = [
    ...await resolveChannelIds(site.id, query.channels),
    ...(query.channelPath ? await resolveChannelPathIds(site.id, query.channelPath) : []),
  ].filter((id, index, all) => effectivelyEnabledIds.has(id) && all.indexOf(id) === index);
  if (channelIds.length > 0) {
    // 聚合主栏目与副栏目，与前台栏目列表保持一致
    const extraIds = db.select({ contentId: cmsContentChannels.contentId })
      .from(cmsContentChannels).where(inArray(cmsContentChannels.channelId, channelIds));
    conditions.push(or(inArray(cmsContents.channelId, channelIds), inArray(cmsContents.id, extraIds))!);
  }

  const tagIds = await resolveTagIds(site.id, query.tags);
  if (tagIds.length > 0) {
    const taggedIds = db.select({ contentId: cmsContentTags.contentId })
      .from(cmsContentTags).where(inArray(cmsContentTags.tagId, tagIds));
    conditions.push(inArray(cmsContents.id, taggedIds));
  }

  if (query.contentTypes.length > 0) {
    conditions.push(inArray(cmsContents.contentType, query.contentTypes as CmsContentRow['contentType'][]));
  }
  if (query.author) conditions.push(eq(cmsContents.author, query.author));
  if (query.modelCode) {
    const [model] = await db.select({ id: cmsModels.id }).from(cmsModels).where(and(
      eq(cmsModels.code, query.modelCode),
      or(isNull(cmsModels.ownerSiteId), eq(cmsModels.ownerSiteId, site.id)),
    )).limit(1);
    if (!model) throw new HTTPException(404, { message: `内容模型「${query.modelCode}」不存在` });
    conditions.push(eq(cmsContents.modelId, model.id));
  }
  if (query.flags.isTop !== undefined) conditions.push(eq(cmsContents.isTop, query.flags.isTop));
  if (query.flags.isRecommend !== undefined) conditions.push(eq(cmsContents.isRecommend, query.flags.isRecommend));
  if (query.flags.isHot !== undefined) conditions.push(eq(cmsContents.isHot, query.flags.isHot));
  if (query.flags.isOriginal !== undefined) conditions.push(eq(cmsContents.isOriginal, query.flags.isOriginal));

  conditions.push(...dateRangeConditions(cmsContents.publishedAt, query.publishedFrom, query.publishedTo));

  if (query.keyword) {
    // 与站内搜索共用分词与 tsquery 构造，保证同一关键词结果集一致
    const condition = buildCmsSearchCondition(query.keyword, site.id);
    conditions.push(condition ?? sql`false`);
  }

  conditions.push(...await buildExtendConditions(site.id, query.extendFilters));
  return conditions;
}

// ─── 输出映射 ────────────────────────────────────────────────────────────────

/** 开放 API 的内容输出形态（与 cmsOpenContentSchema 对齐：除 id 外均可被裁剪掉） */
export type CmsOpenContentOutput = { id: number } & Record<string, unknown>;

interface MapOpenContentOptions {
  channelMap: Map<number, { code: string; path: string; detailPathRule: CmsContentRow['contentType'] extends never ? never : string }>;
  modelMap: Map<number, string>;
  includes: Set<string>;
  tags?: Map<number, { name: string; slug: string }[]>;
  relations?: Map<number, number[]>;
  bodyExtend?: Map<number, { body: string | null; extend: Record<string, unknown> }>;
  linkResolver: CmsLinkResolver;
}

function mapOpenContent(row: CmsContentRow & { coverThumb: string | null }, opts: MapOpenContentOptions): CmsOpenContentOutput {
  const channel = opts.channelMap.get(row.channelId);
  const resolvedExternal = row.externalLink ? opts.linkResolver(row.externalLink) : null;
  const resolvedSource = row.sourceUrl ? opts.linkResolver(row.sourceUrl) : null;
  const out: Record<string, unknown> = {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelCode: channel?.code ?? null,
    modelCode: row.modelId ? (opts.modelMap.get(row.modelId) ?? null) : null,
    contentType: row.contentType,
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
    sourceUrl: resolvedSource?.url ?? null,
    isOriginal: row.isOriginal,
    externalLink: resolvedExternal?.url ?? null,
    isTop: row.isTop,
    topWeight: row.topWeight,
    isRecommend: row.isRecommend,
    isHot: row.isHot,
    hasImage: row.hasImage,
    hasVideo: row.hasVideo,
    hasAttachment: row.hasAttachment,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    favoriteCount: row.favoriteCount,
    sort: row.sort,
    version: row.version,
    seoTitle: row.seoTitle ?? null,
    seoKeywords: row.seoKeywords ?? null,
    seoDescription: row.seoDescription ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    expireAt: formatNullableDateTime(row.expireAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
    url: row.externalLink
      ? (resolvedExternal?.url ?? null)
      : (channel
        ? contentUrl('', { path: channel.path, detailPathRule: channel.detailPathRule as never }, row)
        : null),
  };
  if (opts.includes.has('attachments')) out.attachments = (Array.isArray(row.attachments) ? row.attachments : []).filter((attachment) => {
   if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return false;
    const url = (attachment as unknown as Record<string, unknown>).url;
   return typeof url === 'string' && isValidCmsAssetUrl(url);
  });
  if (opts.includes.has('tags')) out.tags = opts.tags?.get(row.id) ?? [];
  if (opts.includes.has('relations')) out.relations = opts.relations?.get(row.id) ?? [];
  if (opts.includes.has('channel')) {
    out.channel = channel ? { id: row.channelId, code: channel.code, path: channel.path } : null;
  }
  if (opts.includes.has('body')) out.body = opts.bodyExtend?.get(row.id)?.body ?? null;
  if (opts.includes.has('extend')) out.extend = opts.bodyExtend?.get(row.id)?.extend ?? {};
  if (row.contentType !== 'article') {
    const media = { ...((row.mediaData ?? {}) as Record<string, unknown>) };
    if (Array.isArray(media.images)) media.images = media.images.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const value = (item as Record<string, unknown>).url;
      return typeof value === 'string' && isValidCmsAssetUrl(value);
    });
    if (typeof media.mediaUrl === 'string' && !isValidCmsAssetUrl(media.mediaUrl)) delete media.mediaUrl;
    if (typeof media.poster === 'string' && !isValidCmsAssetUrl(media.poster)) delete media.poster;
    out.mediaData = media;
  }
  return out as CmsOpenContentOutput;
}

async function buildMapOptions(
  siteId: number,
  rows: readonly CmsContentRow[],
  includes: Set<string>,
): Promise<MapOpenContentOptions> {
  const channels = await db.select({
    id: cmsChannels.id, code: cmsChannels.code, path: cmsChannels.path,
    detailPathRule: cmsChannels.detailPathRule, status: cmsChannels.status,
  }).from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  const enabledIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  const channelMap = new Map(channels
    .filter((row) => enabledIds.has(row.id))
    .map((row) => [row.id, { code: row.code, path: row.path, detailPathRule: row.detailPathRule as never }]));

  const modelIds = [...new Set(rows.map((row) => row.modelId).filter((id): id is number => id != null))];
  const models = modelIds.length > 0
    ? await db.select({ id: cmsModels.id, code: cmsModels.code }).from(cmsModels).where(and(
        inArray(cmsModels.id, modelIds),
        or(isNull(cmsModels.ownerSiteId), eq(cmsModels.ownerSiteId, siteId)),
      ))
    : [];
  const modelMap = new Map(models.map((row) => [row.id, row.code]));

  const ids = rows.map((row) => row.id);
  const linkResolver = await buildCmsLinkResolver(siteId, '', rows.flatMap((row) => [row.externalLink, row.sourceUrl]));
  const opts: MapOpenContentOptions = { channelMap, modelMap, includes, linkResolver };

  if (includes.has('tags') && ids.length > 0) {
    const rowsTags = await db.select({ contentId: cmsContentTags.contentId, name: cmsTags.name, slug: cmsTags.slug })
      .from(cmsContentTags)
      .innerJoin(cmsTags, eq(cmsContentTags.tagId, cmsTags.id))
      .where(and(inArray(cmsContentTags.contentId, ids), eq(cmsTags.siteId, siteId)));
    const map = new Map<number, { name: string; slug: string }[]>();
    for (const row of rowsTags) {
      const list = map.get(row.contentId) ?? [];
      list.push({ name: row.name, slug: row.slug });
      map.set(row.contentId, list);
    }
    opts.tags = map;
  }

  if (includes.has('relations') && ids.length > 0) {
    const rowsRel = await db.select({ contentId: cmsContentRelations.contentId, relatedId: cmsContentRelations.relatedId })
      .from(cmsContentRelations)
      .where(inArray(cmsContentRelations.contentId, ids))
      .orderBy(asc(cmsContentRelations.sort));
    const relatedIds = [...new Set(rowsRel.map((row) => row.relatedId))];
    const relatedRows = relatedIds.length > 0
      ? await db.select().from(cmsContents).where(and(
          inArray(cmsContents.id, relatedIds),
          eq(cmsContents.siteId, siteId),
        ))
      : [];
    const effectiveChannels = await getEffectivelyEnabledCmsChannelIds(siteId);
    const visibleRelatedIds = new Set(relatedRows
      .filter((row) => isCmsContentPubliclyVisible(row) && effectiveChannels.has(row.channelId))
      .map((row) => row.id));
    const map = new Map<number, number[]>();
    for (const row of rowsRel) {
      if (!visibleRelatedIds.has(row.relatedId)) continue;
      const list = map.get(row.contentId) ?? [];
      list.push(row.relatedId);
      map.set(row.contentId, list);
    }
    opts.relations = map;
  }

  if ((includes.has('body') || includes.has('extend')) && rows.length > 0) {
    // Mapping targets are materialized snapshots. The relationship is kept
    // for governance only and is never dereferenced by the public API.
    const raw = rows.map((row) => ({
      id: row.id,
      coverImage: null,
      body: row.body ?? null,
      extend: row.extend ?? {},
    }));
    const resolvedBodies = await resolveCmsContentRows(raw, siteId);
    opts.bodyExtend = new Map(resolvedBodies.map((row) => [
      row.id,
      { body: row.body ?? null, extend: (row.extend ?? {}) as Record<string, unknown> },
    ]));
  }
  return opts;
}

// ─── 列表 ────────────────────────────────────────────────────────────────────

export async function listOpenCmsContents(site: CmsSiteRow, query: ParsedCmsOpenQuery) {
  const conditions = await buildListConditions(site, query);
  const baseWhere = and(...conditions)!;
  const order = orderByOf(query.sort);

  const [total, rows] = await Promise.all([
    db.$count(cmsContents, baseWhere),
    db.select().from(cmsContents).where(baseWhere).orderBy(...order)
      .limit(query.pageSize).offset(pageOffset(query.page, query.pageSize)),
  ]);
  const resolved = await resolveCmsContentRows(rows, site.id);
  const opts = await buildMapOptions(site.id, rows, query.includes);
  return {
    list: resolved.map((row) => pickCmsOpenFields(mapOpenContent(row, opts), query.fields)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * 游标翻页：keyset 推进，深翻不退化为大 offset，且期间新增内容不会让结果错行。
 * 适合客户端做全量首次拉取。
 */
export async function listOpenCmsContentsByCursor(site: CmsSiteRow, query: ParsedCmsOpenQuery) {
  assertCursorSortable(query.sort);
  const conditions = await buildListConditions(site, query);
  const cursor = query.cursor;
  const primaryField = query.sort[0].field;
  const isTimeSort = TIME_SORT_FIELDS.has(primaryField);
  // 时间列的游标值必须取 PG 的微秒原值：JS Date 只有毫秒，回写的边界永远小于真实值
  const rows = await db.select({
    row: cmsContents,
    micros: isTimeSort ? microsOf(SORT_COLUMNS[primaryField]) : sql<string | null>`null`,
  }).from(cmsContents)
    .where(cursor ? and(and(...conditions)!, cursorCondition(query.sort, cursor)) : and(...conditions)!)
    .orderBy(...orderByOf(query.sort))
    .limit(query.pageSize + 1);
  const hasMore = rows.length > query.pageSize;
  const pageRows = rows.slice(0, query.pageSize);
  const page = pageRows.map((item) => item.row);
  const resolved = await resolveCmsContentRows(page, site.id);
  const opts = await buildMapOptions(site.id, page, query.includes);
  const last = pageRows.at(-1);
  const lastValue = last
    ? (isTimeSort ? (last.micros == null ? null : Number(last.micros)) : cursorValueOf(last.row, primaryField))
    : null;
  return {
    list: resolved.map((row) => pickCmsOpenFields(mapOpenContent(row, opts), query.fields)),
    pageSize: query.pageSize,
    hasMore,
    nextCursor: hasMore && last ? encodeCmsOpenCursor({ value: lastValue, id: last.row.id }) : null,
  };
}

// ─── 详情 ────────────────────────────────────────────────────────────────────

export async function getOpenCmsContent(site: CmsSiteRow, idOrSlug: string, query: ParsedCmsOpenQuery) {
  const numericId = /^\d+$/.test(idOrSlug) ? Number(idOrSlug) : null;
  const matcher = numericId !== null ? eq(cmsContents.id, numericId) : eq(cmsContents.slug, idOrSlug);
  const enabledIds = await getEffectivelyEnabledCmsChannelIds(site.id);
  const [row] = enabledIds.size > 0
    ? await db.select().from(cmsContents).where(and(publicWhere(site.id), inArray(cmsContents.channelId, [...enabledIds]), matcher)).limit(1)
    : [];
  if (!row) throw new HTTPException(404, { message: '内容不存在或未发布' });
  // 详情默认返回正文与扩展字段，无需显式 include
  const includes = new Set([...query.includes, 'body', 'extend', 'tags', 'attachments', 'channel']);
  const [resolved] = await resolveCmsContentRows([row], site.id);
  const opts = await buildMapOptions(site.id, [row], includes);
  return pickCmsOpenFields(mapOpenContent(resolved, opts), query.fields);
}

// ─── 增量同步 ────────────────────────────────────────────────────────────────

/**
 * 按 `updated_at` keyset 输出变更集，元素带 `op`。
 *
 * - `upsert`：当前公开可见的内容
 * - `delete`：不再公开（下线/回收/归档）或已被彻底删除（墓碑表）
 *
 * **两路数据合并为同一个游标流**：内容按 `(updated_at, id)`、墓碑按 `(deleted_at, content_id)`，
 * 两者用同一把 `(时间, id)` 尺子排序并合并后统一截断。早期实现给墓碑单独加 limit、
 * 且不参与 `hasMore` 与 `nextCursor`，一旦某个区间的硬删除超过一页就会被永久丢弃，
 * 客户端缓存里的已删内容再也清不掉。
 */
export async function syncOpenCmsContents(
  site: CmsSiteRow,
  input: { since?: string | null; cursor?: { value: number | null; id: number } | null; pageSize: number; includes: Set<string> },
) {
  const pageSize = Math.min(CMS_OPEN_SYNC_PAGE_SIZE_MAX, Math.max(1, input.pageSize));
  /**
   * 游标时间以**微秒**为单位（与游标列表端点共用 `microsOf` / `microsToTimestamp`）。
   *
   * PG 的 `timestamp` 是微秒精度，而 JS `Date` 只到毫秒：若游标只带毫秒，
   * `updated_at = 11:16:13.818587` 会永远满足 `> 11:16:13.818000`，同一页无限重复。
   * 2026 年的微秒数约 1.78e15，仍在 `Number.MAX_SAFE_INTEGER`（9.0e15）之内。
   */
  let anchor: { micros: number; id: number } | null = null;
  if (input.cursor) {
    anchor = { micros: input.cursor.value ?? 0, id: input.cursor.id };
  } else if (input.since) {
    const parsed = parseDateTimeInput(input.since);
    if (!parsed) throw new OpenQueryError('since 时间格式不正确（YYYY-MM-DD HH:mm:ss）');
    // 首次同步没有 id 锚点：用 -1 让「等于 since 且 id >= 0」的行也进入结果
    anchor = { micros: parsed.getTime() * 1000, id: -1 };
  }
  const anchorTs = anchor ? microsToTimestamp(anchor.micros) : null;

  /** (时间, id) 严格大于锚点 */
  const after = (atColumn: PgColumn, idColumn: PgColumn): SQL | undefined =>
    anchor && anchorTs
      ? or(gt(atColumn, anchorTs), and(eq(atColumn, anchorTs), gt(idColumn, anchor.id)))!
      : undefined;

  const [rows, tombstoneRows] = await Promise.all([
    db.select({ row: cmsContents, micros: microsOf(cmsContents.updatedAt) }).from(cmsContents)
      .where(and(eq(cmsContents.siteId, site.id), after(cmsContents.updatedAt, cmsContents.id)))
      .orderBy(asc(cmsContents.updatedAt), asc(cmsContents.id))
      .limit(pageSize + 1),
    db.select({ row: cmsContentTombstones, micros: microsOf(cmsContentTombstones.deletedAt) }).from(cmsContentTombstones)
      .where(and(
        eq(cmsContentTombstones.siteId, site.id),
        after(cmsContentTombstones.deletedAt, cmsContentTombstones.contentId),
      ))
      .orderBy(asc(cmsContentTombstones.deletedAt), asc(cmsContentTombstones.contentId))
      .limit(pageSize + 1),
  ]);

  type Entry = { micros: number; at: Date; id: number; row?: CmsContentRow };
  const merged: Entry[] = [
    ...rows.map((item) => ({ micros: Number(item.micros), at: item.row.updatedAt, id: item.row.id, row: item.row })),
    ...tombstoneRows.map((item) => ({ micros: Number(item.micros), at: item.row.deletedAt, id: item.row.contentId })),
  ].sort((a, b) => (a.micros - b.micros) || (a.id - b.id));

  const hasMore = merged.length > pageSize;
  const page = merged.slice(0, pageSize);

  // 可见性判定与 publicWhere 保持一致：栏目停用等同下线，这类内容以 delete 下发，
  // 否则集成方会一直保留一份在前台已经看不到的内容。
  const enabledChannelIds = await getEffectivelyEnabledCmsChannelIds(site.id);
  const now = new Date();
  const visible = page
    .map((entry) => entry.row)
    .filter((row): row is CmsContentRow =>
      !!row && isCmsContentPubliclyVisible(row, now)
      && enabledChannelIds.has(row.channelId));
  const resolved = await resolveCmsContentRows(visible, site.id);
  const opts = await buildMapOptions(site.id, visible, input.includes);
  const byId = new Map(resolved.map((row) => [row.id, row]));

  const changes = page.map((entry): { op: 'upsert' | 'delete'; id: number; updatedAt: string; content?: CmsOpenContentOutput } => {
    const resolvedRow = byId.get(entry.id);
    if (!resolvedRow) return { op: 'delete', id: entry.id, updatedAt: formatDateTime(entry.at) };
    return { op: 'upsert', id: entry.id, updatedAt: formatDateTime(entry.at), content: mapOpenContent(resolvedRow, opts) };
  });

  const last = page.at(-1);
  return {
    changes,
    pageSize,
    hasMore,
    nextCursor: hasMore && last ? encodeCmsOpenCursor({ value: last.micros, id: last.id }) : null,
  };
}
