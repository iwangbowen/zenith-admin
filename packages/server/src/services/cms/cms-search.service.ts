import { sql, and, eq, isNull, type SQL } from 'drizzle-orm';
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';
import { db } from '../../db';
import { cmsContents, cmsChannels } from '../../db/schema';
import { formatNullableDateTime } from '../../lib/datetime';
import { escapeLike } from '../../lib/where-helpers';
import type { CmsSearchResult } from '@zenith/shared';

// ─── 分词器（进程级单例，加载默认词典）─────────────────────────────────────────
let jiebaInstance: Jieba | null = null;

function getJieba(): Jieba {
  if (!jiebaInstance) jiebaInstance = Jieba.withDict(dict);
  return jiebaInstance;
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

/** 索引分词：cutForSearch 细粒度切分（同时产出复合词与子词），空格连接供 to_tsvector('simple') 使用 */
export function segmentForIndex(text: string | null | undefined): string {
  const plain = stripHtml(text ?? '');
  if (!plain) return '';
  // 索引正文截断，避免超长文章拖慢写入（tsvector 位置上限 16383）
  const bounded = plain.length > 20000 ? plain.slice(0, 20000) : plain;
  const tokens = getJieba().cutForSearch(bounded, true);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const w = t.trim().toLowerCase();
    if (!w || TOKEN_FILTER.test(w)) continue;
    if (seen.has(w)) continue; // simple parser 不做归一化，重复词无增益，去重减小向量体积
    seen.add(w);
    out.push(w);
  }
  return out.join(' ');
}

/** 查询分词：cut 粗粒度（与索引的细粒度切分配合保证可命中），返回去重 token 数组 */
export function segmentForQuery(keyword: string): string[] {
  const plain = keyword.trim();
  if (!plain) return [];
  const tokens = getJieba().cut(plain, true);
  const out: string[] = [];
  for (const t of tokens) {
    const w = t.trim().toLowerCase();
    if (!w || TOKEN_FILTER.test(w)) continue;
    out.push(w);
  }
  return [...new Set(out)];
}

export interface SearchVectorInput {
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
 */
export function buildSearchVector(input: SearchVectorInput): SQL {
  const a = segmentForIndex(input.title);
  const b = segmentForIndex([input.seoKeywords ?? '', input.summary ?? ''].join(' '));
  const c = segmentForIndex([input.body ?? '', ...(input.extendTexts ?? [])].join(' '));
  return sql`setweight(to_tsvector('simple', ${a}), 'A') || setweight(to_tsvector('simple', ${b}), 'B') || setweight(to_tsvector('simple', ${c}), 'C')`;
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
  const tokens = segmentForQuery(keyword);
  const empty = { list: [] as CmsSearchResult[], total: 0, page, pageSize, tokens };
  if (tokens.length === 0) return empty;

  const tsquery = sql`plainto_tsquery('simple', ${tokens.join(' ')})`;
  const baseWhere = and(
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
  )!;

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
      .offset((page - 1) * pageSize),
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
        .offset((page - 1) * pageSize),
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
    })
      .from(cmsContents)
      .where(scope ? and(scope, cursor) : cursor)
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
