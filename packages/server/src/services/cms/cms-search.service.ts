import { sql, and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';
import { db } from '../../db';
import { cmsContents, cmsChannels, cmsSearchWords } from '../../db/schema';
import { formatNullableDateTime } from '../../lib/datetime';
import { escapeLike } from '../../lib/where-helpers';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import type { CmsSearchResult } from '@zenith/shared';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { pageOffset } from '../../lib/pagination';
import { assertAllCmsSiteChannelsAccess, getAccessibleChannelIds } from './cms-channels.service';
import { loadCmsExtensionWords, normalizeCmsSearchDictionaryWord } from './cms-search-dictionary';

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
export function segmentForQuery(keyword: string, siteId?: number): string[] {
  const plain = keyword.trim();
  if (!plain) return [];
  const tokens = getJieba(siteId).cut(plain, true);
  const stopWords = siteId ? stopWordsBySite.get(siteId) : undefined;
  return filterCmsSearchTokens(tokens, stopWords);
}

export interface SearchVectorInput {
  siteId?: number;
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
 */
export function buildSearchVector(input: SearchVectorInput): SQL {
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

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
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
  title: string;
  slug: string | null;
  summary: string | null;
  body: string | null;
  publishedAt: Date | null;
  rank: number;
}

function mapSearchRow(row: SearchRowShape, tokens: string[]): CmsSearchResult {
  const plainSummary = row.summary?.trim() ? stripHtml(row.summary) : stripHtml(row.body).slice(0, 400);
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: row.channelName,
    title: row.title,
    titleHighlight: highlightTokens(row.title, tokens),
    snippet: buildSnippet(plainSummary, tokens),
    url: `/${row.channelPath ?? ''}/${row.slug ?? row.id}.html`,
    publishedAt: formatNullableDateTime(row.publishedAt),
    rank: Number(row.rank) || 0,
  };
}

/** 站内全文检索：tsvector 匹配 + ts_rank_cd 排序；无命中且关键词很短时回退 ILIKE（pg_trgm 索引加速） */
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
  ];
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
    title: cmsContents.title,
    slug: cmsContents.slug,
    summary: cmsContents.summary,
    body: cmsContents.body,
    publishedAt: cmsContents.publishedAt,
  };

  const ftsWhere = and(baseWhere, sql`${cmsContents.searchVector} @@ ${tsquery}`)!;
  const [total, rows] = await Promise.all([
    db.$count(cmsContents, ftsWhere),
    db.select({ ...selectShape, rank: sql<number>`ts_rank_cd(${cmsContents.searchVector}, ${tsquery})`.as('rank') })
      .from(cmsContents)
      .leftJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
      .where(ftsWhere)
      .orderBy(sql`rank desc`, sql`${cmsContents.publishedAt} desc nulls last`)
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  if (total > 0) {
    return { list: rows.map((r) => mapSearchRow(r, tokens)), total, page, pageSize, tokens };
  }

  // 回退：超短词（如单字）可能不在词典中，用 ILIKE 模糊匹配标题（title 已建 gin_trgm 索引）
  if (keyword.trim().length <= 4) {
    const likeWhere = and(baseWhere, sql`${cmsContents.title} ilike ${'%' + escapeLike(keyword.trim()) + '%'}`)!;
    const [likeTotal, likeRows] = await Promise.all([
      db.$count(cmsContents, likeWhere),
      db.select({ ...selectShape, rank: sql<number>`0`.as('rank') })
        .from(cmsContents)
        .leftJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
        .where(likeWhere)
        .orderBy(sql`${cmsContents.publishedAt} desc nulls last`)
        .limit(pageSize)
        .offset(pageOffset(page, pageSize)),
    ]);
    return { list: likeRows.map((r) => mapSearchRow(r, [keyword.trim()])), total: likeTotal, page, pageSize, tokens };
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
