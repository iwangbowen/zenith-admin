import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { cmsLinkWords } from '../../db/schema';
import type { CmsLinkWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import type { CreateCmsLinkWordInput, UpdateCmsLinkWordInput } from '@zenith/shared/cms';
import { isValidCmsLink } from '@zenith/shared/cms';
import type { CmsLinkResolver } from './cms-link.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';

// ─── 渲染缓存 ─────────────────────────────────────────────────────────────────
let wordCache: { bySite: Map<number, CmsLinkWordRow[]>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateLinkWordCache() {
  wordCache = null;
}

/** 站点启用的内链词（长词优先，避免短词抢占长词的子串） */
export async function getEnabledLinkWords(siteId: number): Promise<CmsLinkWordRow[]> {
  if (!wordCache || Date.now() - wordCache.loadedAt >= CACHE_TTL_MS) {
    const rows = (await db.select().from(cmsLinkWords).where(eq(cmsLinkWords.status, 'enabled')))
      .filter((row) => isValidCmsLink(row.url));
    const bySite = new Map<number, CmsLinkWordRow[]>();
    for (const row of rows) {
      const arr = bySite.get(row.siteId) ?? [];
      arr.push(row);
      bySite.set(row.siteId, arr);
    }
    for (const arr of bySite.values()) {
      arr.sort((a, b) => b.keyword.length - a.keyword.length);
    }
    wordCache = { bySite, loadedAt: Date.now() };
  }
  return wordCache.bySite.get(siteId) ?? [];
}

/**
 * 正文内链词替换：仅处理标签外的文本节点，跳过 <a>/<script>/<style> 内部，
 * 每个关键词按 maxReplaces 限次替换。
 */
export function applyLinkWords(html: string, words: Pick<CmsLinkWordRow, 'keyword' | 'url' | 'maxReplaces'>[], resolveLink?: CmsLinkResolver): string {
  if (!html || words.length === 0) return html;
  const safeWords = words.filter((word) => isValidCmsLink(word.url) && (!resolveLink || !!resolveLink(word.url)));
  if (safeWords.length === 0) return html;
  const budgets = new Map(safeWords.map((w) => [w.keyword, w.maxReplaces]));
  // URL 进入 href 属性上下文，必须转义防注入；命中的关键词文本保持原样（源 HTML 已是安全文本节点）
  const escapeAttr = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const parts = html.split(/(<[^>]+>)/g);
  let skipDepth = 0; // 处于 <a>/<script>/<style> 内部的层级
  const escapedKeywords = [...safeWords]
    .sort((a, b) => b.keyword.length - a.keyword.length)
    .map((word) => word.keyword.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  const keywordPattern = escapedKeywords.length > 0 ? new RegExp(escapedKeywords.join('|'), 'giu') : null;
  const out = parts.map((part) => {
    if (part.startsWith('<')) {
      const open = /^<(a|script|style)[\s>]/i.exec(part);
      const close = /^<\/(a|script|style)>/i.exec(part);
      if (open) skipDepth += 1;
      if (close && skipDepth > 0) skipDepth -= 1;
      return part;
    }
    if (skipDepth > 0 || !part.trim()) return part;
    if (!keywordPattern) return part;
    return part.replace(keywordPattern, (matched) => {
      const word = safeWords.find((candidate) => candidate.keyword.toLocaleLowerCase() === matched.toLocaleLowerCase());
      if (!word) return matched;
      const budget = budgets.get(word.keyword) ?? 0;
      if (budget <= 0) return matched;
      budgets.set(word.keyword, budget - 1);
      const resolved = resolveLink?.(word.url)?.url ?? word.url;
      const textValue = matched.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      return `<a href="${escapeAttr(resolved)}" class="cms-link-word">${textValue}</a>`;
    });
  });
  return out.join('');
}

// ─── 数据映射 / CRUD ──────────────────────────────────────────────────────────
export function mapCmsLinkWord(row: CmsLinkWordRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    keyword: row.keyword,
    url: row.url,
    maxReplaces: row.maxReplaces,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsLinkWordExists(id: number): Promise<CmsLinkWordRow> {
  const [row] = await db.select().from(cmsLinkWords).where(eq(cmsLinkWords.id, id)).limit(1);
  return requireRow(row, '内链词不存在');
}

export interface ListCmsLinkWordsQuery {
  siteId: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listCmsLinkWords(q: ListCmsLinkWordsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: (SQL | undefined)[] = [eq(cmsLinkWords.siteId, q.siteId)];
  conditions.push(keywordCondition(q.keyword, [cmsLinkWords.keyword]));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsLinkWords, where),
    rows: () => withPagination(
      db.select().from(cmsLinkWords).where(where).orderBy(asc(cmsLinkWords.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: mapCmsLinkWord,
  });
}

export async function createCmsLinkWord(data: CreateCmsLinkWordInput) {
  await assertSiteAccess(data.siteId);
  try {
    const [row] = await db.insert(cmsLinkWords).values(data).returning();
    invalidateLinkWordCache();
    await refreshCmsPublicConfiguration(row.siteId, '内链词创建', `link-word:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsLinkWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下该关键词已存在');
  }
}

export async function updateCmsLinkWord(id: number, data: UpdateCmsLinkWordInput) {
  const current = await ensureCmsLinkWordExists(id);
  await assertSiteAccess(current.siteId);
  try {
    const [row] = await db.update(cmsLinkWords).set(data).where(eq(cmsLinkWords.id, id)).returning();
    invalidateLinkWordCache();
    await refreshCmsPublicConfiguration(row.siteId, '内链词更新', `link-word:${row.id}:${row.updatedAt.getTime()}`);
    return mapCmsLinkWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下该关键词已存在');
  }
}

export async function deleteCmsLinkWord(id: number) {
  const current = await ensureCmsLinkWordExists(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsLinkWords).where(eq(cmsLinkWords.id, id));
  invalidateLinkWordCache();
  await refreshCmsPublicConfiguration(current.siteId, '内链词删除', `link-word:${current.id}:deleted:${Date.now()}`);
}
