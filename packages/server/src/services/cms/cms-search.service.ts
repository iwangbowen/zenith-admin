import { sql, and, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict.js';
import { db } from '../../db';
import { cmsContents, cmsChannels, cmsSearchWords } from '../../db/schema';
import { formatNullableDateTime } from '../../lib/datetime';
import { keywordCondition } from '../../lib/where-helpers';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import type { CmsChannelDetailPathRule, CmsSearchResult } from '@zenith/shared/cms';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { contentUrl } from './cms-urls';
import { buildCmsLinkResolver } from './cms-link.service';
import type { CmsLinkResolver } from './cms-link.service';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { pageOffset } from '../../lib/pagination';
import { assertAllCmsSiteChannelsAccess, getAccessibleChannelIds } from './cms-channels.service';
import { loadCmsExtensionWords, normalizeCmsSearchDictionaryWord } from './cms-search-dictionary';
import { listSummaryOf } from './cms-content-columns';
import { escapeHtml } from '@zenith/shared/core';

// ─── 分词器（进程级单例，加载默认词典 + DB 自定义词典）─────────────────────────
const jiebaBySite = new Map<number, Jieba>();
const stopWordsBySite = new Map<number, Set<string>>();
let defaultJieba: Jieba | null = null;

function getJieba(siteId?: number): Jieba {
  if (siteId && jiebaBySite.has(siteId)) return jiebaBySite.get(siteId)!;
  if (!defaultJieba) defaultJieba = Jieba.withDict(dict);
  return defaultJieba;
}

/**
 * 从 DB 为每个站点重建独立词典；逐词加载隔离坏词，停用词单独维护。
 * 启动时与词典 CRUD 后调用。
 */
export async function reloadCmsSearchDict(siteId?: number): Promise<number> {
  const rows = await db.select().from(cmsSearchWords).where(and(
    eq(cmsSearchWords.status, 'enabled'),
    ...(siteId ? [eq(cmsSearchWords.siteId, siteId)] : []),
  ));
  const grouped = new Map<number, typeof rows>();
  for (const row of rows) grouped.set(row.siteId, [...(grouped.get(row.siteId) ?? []), row]);
  if (siteId && !grouped.has(siteId)) grouped.set(siteId, []);
  if (!siteId) {
    jiebaBySite.clear();
    stopWordsBySite.clear();
  }
  let accepted = 0;
  for (const [targetSiteId, siteRows] of grouped) {
    const jieba = Jieba.withDict(dict);
    const extensions = siteRows.filter((row) => row.type === 'extension');
    const loadedExtensions = loadCmsExtensionWords(jieba, extensions, (row, error) => {
      logger.warn(`[CMS] 站点 ${targetSiteId} 跳过无效扩展词 #${row.id}「${row.word}」`, error);
    });
    jiebaBySite.set(targetSiteId, jieba);
    const stopWords = new Set(
      siteRows
        .filter((row) => row.type === 'stop')
        .map((row) => normalizeCmsSearchDictionaryWord(row.word)?.toLowerCase())
        .filter((word): word is string => !!word),
    );
    stopWordsBySite.set(targetSiteId, stopWords);
    accepted += loadedExtensions + stopWords.size;
    if (loadedExtensions !== extensions.length) {
      logger.warn(`[CMS] 站点 ${targetSiteId} 扩展词加载 ${loadedExtensions}/${extensions.length}`);
    }
  }
  return accepted;
}

// ─── tsvector 解析器配置（默认 simple=应用层 jieba 分词；可切 zhparser 等 PG 扩展配置）──
const TSVECTOR_CONFIG = /^[a-z_][a-z0-9_]*$/.test(process.env.CMS_TSVECTOR_CONFIG ?? '')
  ? (process.env.CMS_TSVECTOR_CONFIG as string)
  : 'simple';

/** 当前是否使用应用层分词（simple parser 需要预分词；PG 扩展配置直接吃原文） */
export function usesAppSegmentation(): boolean {
  return TSVECTOR_CONFIG === 'simple';
}

// ─── 搜索热词（Redis ZSET，前台每次检索计数）───────────────────────────────────
const HOTWORD_PREFIX = `${config.redis.keyPrefix}cms:hotwords:`;

export function recordSearchKeyword(siteId: number, keyword: string): void {
  const kw = keyword.trim().slice(0, 32);
  if (!kw) return;
  redis.zincrby(`${HOTWORD_PREFIX}${siteId}`, 1, kw).catch(() => undefined);
}

export async function getHotKeywords(siteId: number, limit = 20): Promise<{ keyword: string; count: number }[]> {
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  const raw = await redis.zrevrange(`${HOTWORD_PREFIX}${siteId}`, 0, limit - 1, 'WITHSCORES').catch(() => [] as string[]);
  const out: { keyword: string; count: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    out.push({ keyword: raw[i], count: Number(raw[i + 1]) || 0 });
  }
  return out;
}

export async function clearHotKeywords(siteId: number): Promise<void> {
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  await redis.del(`${HOTWORD_PREFIX}${siteId}`).catch(() => undefined);
}

/** 去除 HTML 标签与常见实体，得到纯文本（用于索引与摘要） */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const TOKEN_FILTER = /^[\s\p{P}\p{S}]*$/u;

export function filterCmsSearchTokens(tokens: string[], stopWords: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const word = token.trim().toLowerCase();
    if (!word || TOKEN_FILTER.test(word) || stopWords.has(word) || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
  }
  return result;
}

/** 索引分词：cutForSearch 细粒度切分（同时产出复合词与子词），空格连接供 to_tsvector('simple') 使用 */
export function segmentForIndex(text: string | null | undefined, siteId?: number): string {
  const plain = stripHtml(text ?? '');
  if (!plain) return '';
  // 索引正文截断，避免超长文章拖慢写入（tsvector 位置上限 16383）
  const bounded = plain.length > 20000 ? plain.slice(0, 20000) : plain;
  const tokens = getJieba(siteId).cutForSearch(bounded, true);
  const stopWords = siteId ? stopWordsBySite.get(siteId) : undefined;
  return filterCmsSearchTokens(tokens, stopWords).join(' ');
}

/** 查询分词：cut 粗粒度（与索引的细粒度切分配合保证可命中），返回去重 token 数组 */
export function segmentForQuery(keyword: string, siteId?: number): string[] {  const plain = keyword.trim();
  if (!plain) return [];
  const tokens = getJieba(siteId).cut(plain, true);
  const stopWords = siteId ? stopWordsBySite.get(siteId) : undefined;
  return filterCmsSearchTokens(tokens, stopWords);
}

/**
 * 全文检索匹配条件（`search_vector @@ tsquery`）。
 *
 * 与 `searchCmsContents` 共用同一套分词与 tsquery 构造，避免开放 API 与站内搜索
 * 在同一关键词上给出不同结果集。关键词切不出 token 时返回 null，调用方按「无命中」处理。
 */
export function buildCmsSearchCondition(keyword: string, siteId: number): SQL | null {
  const tokens = segmentForQuery(keyword, siteId);
  if (tokens.length === 0) return null;
  const cfg = sql.raw(`'${TSVECTOR_CONFIG}'`);
  const tsquery = usesAppSegmentation()
    ? sql`plainto_tsquery(${cfg}::regconfig, ${tokens.join(' ')})`
    : sql`plainto_tsquery(${cfg}::regconfig, ${keyword.trim()})`;
  return sql`${cmsContents.searchVector} @@ ${tsquery}`;
}

export interface SearchVectorInput {  siteId?: number;
  title: string;
  seoKeywords?: string | null;
  summary?: string | null;
  body?: string | null;
  /** 模型自定义字段中 searchable=true 的文本值 */
  extendTexts?: string[];
}

/**
 * 生成 search_vector 的 SQL 表达式：
 * 标题权重 A，关键词/摘要权重 B，正文与扩展字段权重 C。
 * simple 配置走应用层 jieba 分词；其他配置（如 zhparser 的 chinese_zh）由 PG 直接解析原文。
 * 仅限本文件内部使用；业务写入一律走 contentSearchVector / contentSearchVectorOnUpdate。
 */
function buildSearchVector(input: SearchVectorInput): SQL {
  const cfg = sql.raw(`'${TSVECTOR_CONFIG}'`);
  if (usesAppSegmentation()) {
    const a = segmentForIndex(input.title, input.siteId);
    const b = segmentForIndex([input.seoKeywords ?? '', input.summary ?? ''].join(' '), input.siteId);
    const c = segmentForIndex([input.body ?? '', ...(input.extendTexts ?? [])].join(' '), input.siteId);
    return sql`setweight(to_tsvector(${cfg}::regconfig, ${a}), 'A') || setweight(to_tsvector(${cfg}::regconfig, ${b}), 'B') || setweight(to_tsvector(${cfg}::regconfig, ${c}), 'C')`;
  }
  const a = stripHtml(input.title);
  const b = stripHtml([input.seoKeywords ?? '', input.summary ?? ''].join(' '));
  const c = stripHtml([input.body ?? '', ...(input.extendTexts ?? [])].join(' ')).slice(0, 20000);
  return sql`setweight(to_tsvector(${cfg}::regconfig, ${a}), 'A') || setweight(to_tsvector(${cfg}::regconfig, ${b}), 'B') || setweight(to_tsvector(${cfg}::regconfig, ${c}), 'C')`;
}

/** 内容行中参与检索向量的字段（行、patch 或行片段均可满足该结构） */
export interface ContentSearchSource {
  title: string;
  seoKeywords?: string | null;
  summary?: string | null;
  body?: string | null;
}

/** 从模型扩展字段值中提取可检索的字符串（分发同步 / 种子等无模型上下文的场景） */
export function extendSearchTexts(extend: Record<string, unknown> | null | undefined): string[] {
  return Object.values(extend ?? {}).filter((value): value is string => typeof value === 'string');
}

/**
 * cms_contents.search_vector 的唯一写入口（新建 / 快照类写入）。
 * 所有 cmsContents 的 insert 必须经本函数派生检索向量；更新合并场景用
 * contentSearchVectorOnUpdate。禁止在业务代码中手工拼装 to_tsvector 表达式。
 */
export function contentSearchVector(siteId: number, source: ContentSearchSource, extendTexts: string[] = []): SQL {
  return buildSearchVector({
    siteId,
    title: source.title,
    seoKeywords: source.seoKeywords ?? null,
    summary: source.summary ?? null,
    body: source.body ?? null,
    extendTexts,
  });
}

/** 更新场景的唯一写入口：patch 未提供的可检索字段回落当前行的值 */
export function contentSearchVectorOnUpdate(
  current: ContentSearchSource & { siteId: number },
  patch: Partial<ContentSearchSource>,
  extendTexts: string[] = [],
): SQL {
  return contentSearchVector(current.siteId, {
    title: patch.title ?? current.title,
    seoKeywords: patch.seoKeywords !== undefined ? patch.seoKeywords : current.seoKeywords,
    summary: patch.summary !== undefined ? patch.summary : current.summary,
    body: patch.body !== undefined ? patch.body : current.body,
  }, extendTexts);
}

/** Node 侧高亮：将命中 token 用 <mark> 包裹（先 HTML 转义再高亮，防注入） */
export function highlightTokens(text: string, tokens: string[]): string {
  let out = escapeHtml(text);
  for (const t of tokens) {
    if (!t) continue;
    const escaped = escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    out = out.replace(new RegExp(escaped, 'gi'), (m) => `<mark>${m}</mark>`);
  }
  return out;
}

/** 从纯文本中截取包含首个命中词的摘要片段并高亮 */
export function buildSnippet(plainText: string, tokens: string[], radius = 60): string {
  if (!plainText) return '';
  const lower = plainText.toLowerCase();
  let hitIndex = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (hitIndex < 0 || i < hitIndex)) hitIndex = i;
  }
  let fragment: string;
  if (hitIndex < 0) {
    fragment = plainText.slice(0, radius * 2);
  } else {
    const start = Math.max(0, hitIndex - radius);
    fragment = (start > 0 ? '…' : '') + plainText.slice(start, hitIndex + radius) + (hitIndex + radius < plainText.length ? '…' : '');
  }
  return highlightTokens(fragment, tokens);
}

export interface CmsSearchQuery {
  skipAccessCheck?: boolean;
  siteId: number;
  keyword: string;
  page: number;
  pageSize: number;
}

interface SearchRowShape {
  id: number;
  siteId: number;
  channelId: number;
  channelName: string | null;
  channelPath: string | null;
  channelDetailPathRule: CmsChannelDetailPathRule | null;
  title: string;
  slug: string | null;
  staticPath: string | null;
  contentType: string;
  externalLink: string | null;
  summary: string | null;
  excerpt: string | null;
  publishedAt: Date | null;
  createdAt: Date | null;
  rank: number;
}

function mapSearchRow(row: SearchRowShape, tokens: string[], resolveLink?: CmsLinkResolver): CmsSearchResult {
  // 导语来源与列表一致：手填摘要，否则数据库生成列 excerpt（正文纯文本前 400 字），结果页不再解压正文
  const plainSummary = stripHtml(listSummaryOf(row, 400) ?? '');
  // 外链形态：搜索结果直接指向外部地址；站内形态必须与静态化/模板共用 contentUrl()，
  // 否则归档目录（detailPathRule）与自定义 staticPath 的内容会得到指向 404 的手拼链接
  const resolvedLink = row.externalLink ? resolveLink?.(row.externalLink) : null;
  const isExternal = resolvedLink?.isExternal === true;
  const url = resolvedLink?.url ?? (row.externalLink
    ? '#'
    : contentUrl(
        '',
        { path: row.channelPath ?? '', detailPathRule: row.channelDetailPathRule ?? 'none' },
        { id: row.id, slug: row.slug, staticPath: row.staticPath, publishedAt: row.publishedAt, createdAt: row.createdAt },
      ));
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: row.channelName,
    title: row.title,
    titleHighlight: highlightTokens(row.title, tokens),
    snippet: buildSnippet(plainSummary, tokens),
    url,
    isExternal,
    publishedAt: formatNullableDateTime(row.publishedAt),
    rank: Number(row.rank) || 0,
  };
}

/** 站内全文检索：精确 AND 命中 → 前缀 OR 近似召回 → 标题 ILIKE 兜底，三级召回逐级放宽 */
export async function searchCmsContents(q: CmsSearchQuery): Promise<{ list: CmsSearchResult[]; total: number; page: number; pageSize: number; tokens: string[] }> {
  const { siteId, keyword, page, pageSize } = q;
  if (!q.skipAccessCheck) {
    await ensureCmsSiteExists(siteId);
    await assertSiteAccess(siteId);
  }
  const accessibleChannelIds = q.skipAccessCheck ? null : await getAccessibleChannelIds();
  if (!jiebaBySite.has(siteId)) await reloadCmsSearchDict(siteId);
  const tokens = segmentForQuery(keyword, siteId);
  const empty = { list: [] as CmsSearchResult[], total: 0, page, pageSize, tokens };
  if (tokens.length === 0) return empty;
  recordSearchKeyword(siteId, keyword);

  const cfg = sql.raw(`'${TSVECTOR_CONFIG}'`);
  const tsquery = usesAppSegmentation()
    ? sql`plainto_tsquery(${cfg}::regconfig, ${tokens.join(' ')})`
    : sql`plainto_tsquery(${cfg}::regconfig, ${keyword.trim()})`;
  const baseConditions: SQL[] = [
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date()))!,
    eq(cmsChannels.status, 'enabled'),
    eq(cmsChannels.siteId, siteId),
  ];
  const effectivelyEnabledChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  if (effectivelyEnabledChannelIds.size === 0) return empty;
  baseConditions.push(inArray(cmsChannels.id, [...effectivelyEnabledChannelIds]));
  if (accessibleChannelIds !== null) {
    baseConditions.push(inArray(cmsContents.channelId, accessibleChannelIds));
  }
  const baseWhere = and(...baseConditions)!;

  const selectShape = {
    id: cmsContents.id,
    siteId: cmsContents.siteId,
    channelId: cmsContents.channelId,
    channelName: cmsChannels.name,
    channelPath: cmsChannels.path,
    channelDetailPathRule: cmsChannels.detailPathRule,
    title: cmsContents.title,
    slug: cmsContents.slug,
    staticPath: cmsContents.staticPath,
    contentType: cmsContents.contentType,
    externalLink: cmsContents.externalLink,
    summary: cmsContents.summary,
    excerpt: cmsContents.excerpt,
    publishedAt: cmsContents.publishedAt,
    createdAt: cmsContents.createdAt,
  };
  const countMatching = async (where: SQL): Promise<number> => {
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(cmsContents)
      .innerJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
      .where(where);
    return result?.count ?? 0;
  };

  const ftsWhere = and(baseWhere, sql`${cmsContents.searchVector} @@ ${tsquery}`)!;
  const [total, rows] = await Promise.all([
    countMatching(ftsWhere),
    db.select({ ...selectShape, rank: sql<number>`ts_rank_cd(${cmsContents.searchVector}, ${tsquery})`.as('rank') })
      .from(cmsContents)
      .leftJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
      .where(ftsWhere)
      .orderBy(sql`rank desc`, sql`${cmsContents.publishedAt} desc nulls last`)
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  if (total > 0) {
    const resolveLink = await buildCmsLinkResolver(siteId, '', rows.map((r) => r.externalLink));
    return { list: rows.map((r) => mapSearchRow(r, tokens, resolveLink)), total, page, pageSize, tokens };
  }

  // 回退一（仅应用层分词配置）：截断词/两侧切词不齐时 AND 全命中会整体落空，
  // 改用「前缀 + OR」近似召回（遗 → 遗失:*），ts_rank_cd 保证命中越多越靠前
  if (usesAppSegmentation()) {
    const prefixTokens = tokens.filter((t) => /^[\p{L}\p{N}]+$/u.test(t)).slice(0, 10);
    if (prefixTokens.length > 0) {
      const orTsquery = sql`to_tsquery(${cfg}::regconfig, ${prefixTokens.map((t) => `${t}:*`).join(' | ')})`;
      const orWhere = and(baseWhere, sql`${cmsContents.searchVector} @@ ${orTsquery}`)!;
      const [orTotal, orRows] = await Promise.all([
        countMatching(orWhere),
        db.select({ ...selectShape, rank: sql<number>`ts_rank_cd(${cmsContents.searchVector}, ${orTsquery})`.as('rank') })
          .from(cmsContents)
          .leftJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
          .where(orWhere)
          .orderBy(sql`rank desc`, sql`${cmsContents.publishedAt} desc nulls last`)
          .limit(pageSize)
          .offset(pageOffset(page, pageSize)),
      ]);
      if (orTotal > 0) {
        const resolveLink = await buildCmsLinkResolver(siteId, '', orRows.map((r) => r.externalLink));
        return { list: orRows.map((r) => mapSearchRow(r, tokens, resolveLink)), total: orTotal, page, pageSize, tokens };
      }
    }
  }

  // 回退二：整串 ILIKE 模糊匹配标题（title 已建 gin_trgm 索引），兜住词典完全切不准的关键词
  if (keyword.trim().length <= 32) {
    const likeWhere = and(baseWhere, keywordCondition(keyword, [cmsContents.title], 'ilike'))!;
    const [likeTotal, likeRows] = await Promise.all([
      countMatching(likeWhere),
      db.select({ ...selectShape, rank: sql<number>`0`.as('rank') })
        .from(cmsContents)
        .leftJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
        .where(likeWhere)
        .orderBy(sql`${cmsContents.publishedAt} desc nulls last`)
        .limit(pageSize)
        .offset(pageOffset(page, pageSize)),
    ]);
    const resolveLink = await buildCmsLinkResolver(siteId, '', likeRows.map((r) => r.externalLink));
    return { list: likeRows.map((r) => mapSearchRow(r, [keyword.trim()], resolveLink)), total: likeTotal, page, pageSize, tokens };
  }

  return empty;
}

/** 全量重建 search_vector（可按站点过滤），分批处理；onProgress 返回 true 表示请求取消 */
export async function rebuildSearchIndex(options: {
  siteId?: number | null;
  batchSize?: number;
  startAfterId?: number;
  onProgress?: (processed: number, total: number, lastId: number) => Promise<boolean | void>;
}): Promise<number> {
  const { siteId, batchSize = 200, onProgress } = options;
  const scope = siteId ? eq(cmsContents.siteId, siteId) : undefined;
  const total = await db.$count(cmsContents, scope);
  let processed = 0;
  let lastId = options.startAfterId ?? 0;
  for (;;) {
    const cursor = sql`${cmsContents.id} > ${lastId}`;
    const rows = await db.select({
      id: cmsContents.id,
      title: cmsContents.title,
      seoKeywords: cmsContents.seoKeywords,
      summary: cmsContents.summary,
      body: cmsContents.body,
      extend: cmsContents.extend,
      siteId: cmsContents.siteId,
    })
      .from(cmsContents)
      .where(scope ? and(scope, cursor, isNull(cmsContents.lockedAt)) : and(cursor, isNull(cmsContents.lockedAt)))
      .orderBy(cmsContents.id)
      .limit(batchSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      const extendTexts = Object.values(row.extend ?? {}).filter((v): v is string => typeof v === 'string');
      await db.update(cmsContents)
        .set({ searchVector: buildSearchVector({ ...row, extendTexts }) })
        .where(eq(cmsContents.id, row.id));
      processed += 1;
      lastId = row.id;
    }
    const cancelled = await onProgress?.(processed, total, lastId);
    if (cancelled === true) break;
  }
  return processed;
}
