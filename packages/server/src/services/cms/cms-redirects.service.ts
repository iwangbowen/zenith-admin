import { eq, asc, and, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsRedirects, cmsSites } from '../../db/schema';
import type { CmsRedirectRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { assertSiteAccess } from './cms-sites.service';
import type { CreateCmsRedirectInput, UpdateCmsRedirectInput } from '@zenith/shared';

// ─── 开放重定向防护 ────────────────────────────────────────────────────────────
/** 目标地址是否可信：站内相对路径，或域名属于本系统任一站点（站群互跳） */
async function isTrustedRedirectTarget(toUrl: string): Promise<boolean> {
  if (toUrl.startsWith('/') && !toUrl.startsWith('//')) return true;
  let parsed: URL;
  try {
    parsed = new URL(toUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const rows = await db.select({ domain: cmsSites.domain, aliasDomains: cmsSites.aliasDomains }).from(cmsSites);
  const trusted = new Set<string>();
  for (const row of rows) {
    if (row.domain) trusted.add(row.domain.toLowerCase());
    for (const alias of row.aliasDomains ?? []) trusted.add(alias.toLowerCase());
  }
  return trusted.has(parsed.hostname.toLowerCase());
}

/** 创建/更新前校验目标地址，防止配置为任意外域形成钓鱼跳板 */
async function assertTrustedRedirectTarget(toUrl: string): Promise<void> {
  if (!(await isTrustedRedirectTarget(toUrl))) {
    throw new HTTPException(400, { message: '目标地址仅允许站内路径（/ 开头）或本系统站点域名的完整 URL' });
  }
}

// ─── 前台匹配缓存（30s 内存缓存，写操作后失效）─────────────────────────────────
let redirectCache: { bySite: Map<number, Map<string, CmsRedirectRow>>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

function invalidateRedirectCache() {
  redirectCache = null;
}

async function getRedirectCache() {
  if (redirectCache && Date.now() - redirectCache.loadedAt < CACHE_TTL_MS) return redirectCache;
  const rows = await db.select().from(cmsRedirects).where(eq(cmsRedirects.status, 'enabled'));
  const bySite = new Map<number, Map<string, CmsRedirectRow>>();
  for (const row of rows) {
    const map = bySite.get(row.siteId) ?? new Map<string, CmsRedirectRow>();
    map.set(row.fromPath, row);
    bySite.set(row.siteId, map);
  }
  redirectCache = { bySite, loadedAt: Date.now() };
  return redirectCache;
}

/** 前台路由：解析站内路径是否命中重定向规则（目标地址二次校验兜底，防历史脏数据外跳） */
export async function resolveRedirect(siteId: number, path: string): Promise<{ toUrl: string; type: number } | null> {
  const cache = await getRedirectCache();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const hit = cache.bySite.get(siteId)?.get(normalized);
  if (!hit) return null;
  if (!(await isTrustedRedirectTarget(hit.toUrl))) return null;
  return { toUrl: hit.toUrl, type: hit.redirectType };
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsRedirect(row: CmsRedirectRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    fromPath: row.fromPath,
    toUrl: row.toUrl,
    redirectType: row.redirectType,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsRedirectExists(id: number): Promise<CmsRedirectRow> {
  const [row] = await db.select().from(cmsRedirects).where(eq(cmsRedirects.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '重定向规则不存在' });
  return row;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
export interface ListCmsRedirectsQuery {
  siteId: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listCmsRedirects(q: ListCmsRedirectsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsRedirects.siteId, q.siteId)];
  if (q.keyword) conditions.push(like(cmsRedirects.fromPath, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsRedirects, where),
    withPagination(
      db.select().from(cmsRedirects).where(where).orderBy(asc(cmsRedirects.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsRedirect), total, page: q.page, pageSize: q.pageSize };
}

export async function createCmsRedirect(data: CreateCmsRedirectInput) {
  await assertSiteAccess(data.siteId);
  await assertTrustedRedirectTarget(data.toUrl);
  try {
    const [row] = await db.insert(cmsRedirects).values(data).returning();
    invalidateRedirectCache();
    return mapCmsRedirect(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同来源路径的规则');
  }
}

export async function updateCmsRedirect(id: number, data: UpdateCmsRedirectInput) {
  const current = await ensureCmsRedirectExists(id);
  await assertSiteAccess(current.siteId);
  if (data.toUrl !== undefined) await assertTrustedRedirectTarget(data.toUrl);
  try {
    const [row] = await db.update(cmsRedirects).set(data).where(eq(cmsRedirects.id, id)).returning();
    invalidateRedirectCache();
    return mapCmsRedirect(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '同站点下已存在相同来源路径的规则');
  }
}

export async function deleteCmsRedirect(id: number) {
  const current = await ensureCmsRedirectExists(id);
  await assertSiteAccess(current.siteId);
  await db.delete(cmsRedirects).where(eq(cmsRedirects.id, id));
  invalidateRedirectCache();
}
