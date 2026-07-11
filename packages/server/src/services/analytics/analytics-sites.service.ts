
import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateAnalyticsSiteInput, UpdateAnalyticsSiteInput } from '@zenith/shared';
import { db } from '../../db';
import { analyticsSites } from '../../db/schema';
import type { AnalyticsSiteRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { currentCreateTenantId, tenantScope } from '../../lib/tenant';
import { escapeLike, mergeWhere } from '../../lib/where-helpers';
import { getSiteQuotaUsage } from './analytics-quota.service';

const SITE_CACHE_TTL_MS = 60_000;
// siteKey 是匿名入口的用户可控输入：负缓存条目也会入 Map，必须设上限防止随机 key 灌爆内存
const SITE_CACHE_MAX_ENTRIES = 500;

export interface AnalyticsSiteListQuery { page?: number; pageSize?: number; name?: string; appId?: string; status?: 'enabled' | 'disabled' | '' }
export interface ResolvedAnalyticsSite {
  id: number;
  tenantId: number | null;
  appId: string;
  status: 'enabled' | 'disabled';
  allowedOrigins: string[] | null;
  dailyEventQuota: number | null;
}

type SiteWithTenant = AnalyticsSiteRow & { tenant?: { name: string | null } | null };

interface SiteCacheEntry { fetchedAt: number; value: ResolvedAnalyticsSite | null }
const siteCache = new Map<string, SiteCacheEntry>();
const loadingByKey = new Map<string, Promise<ResolvedAnalyticsSite | null>>();

export function generateSiteKey(): string {
  return `zk_${randomBytes(16).toString('hex')}`;
}

export function mapSite(row: SiteWithTenant) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    siteKey: row.siteKey,
    name: row.name,
    appId: row.appId,
    allowedOrigins: row.allowedOrigins ?? null,
    dailyEventQuota: row.dailyEventQuota,
    todayUsage: null,
    status: row.status,
    remark: row.remark,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function normalizeOriginForCompare(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export function isSiteOriginAllowed(origin: string | null | undefined, allowedOrigins: string[] | null | undefined): boolean {
  const whitelist = allowedOrigins?.map(normalizeOriginForCompare).filter(Boolean) ?? [];
  if (whitelist.length === 0) return true;
  if (!origin) return false;
  return whitelist.includes(normalizeOriginForCompare(origin));
}

function normalizeOrigins(value: string[] | null | undefined): string[] | null {
  if (!value || value.length === 0) return null;
  const deduped = Array.from(new Set(value.map((origin) => origin.trim()).filter(Boolean)));
  return deduped.length > 0 ? deduped : null;
}

function invalidateSiteCache(siteKey?: string): void {
  if (siteKey) siteCache.delete(siteKey);
  else siteCache.clear();
  if (siteKey) loadingByKey.delete(siteKey);
  else loadingByKey.clear();
}

export async function listSites(q: AnalyticsSiteListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const conditions: SQL[] = [];
  if (q.name) conditions.push(sql`${analyticsSites.name} ILIKE ${'%' + escapeLike(q.name) + '%'}`);
  if (q.appId) conditions.push(eq(analyticsSites.appId, q.appId));
  if (q.status) conditions.push(eq(analyticsSites.status, q.status));
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, tenantScope(analyticsSites));
  const [list, total] = await Promise.all([
    db.query.analyticsSites.findMany({ where, with: { tenant: true }, orderBy: [desc(analyticsSites.id)], limit: pageSize, offset: pageOffset(page, pageSize) }),
    db.$count(analyticsSites, where),
  ]);
  const usageBySiteId = await getSiteQuotaUsage(list.map((site) => site.id));
  return {
    list: list.map((site) => ({ ...mapSite(site), todayUsage: usageBySiteId.has(site.id) ? usageBySiteId.get(site.id)! : 0 })),
    total,
    page,
    pageSize,
  };
}

async function ensureSiteExists(id: number): Promise<AnalyticsSiteRow> {
  const where = mergeWhere(eq(analyticsSites.id, id), tenantScope(analyticsSites));
  const [row] = await db.select().from(analyticsSites).where(where).limit(1);
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  return row;
}

export async function createSite(input: CreateAnalyticsSiteInput) {
  try {
    const [row] = await db.insert(analyticsSites).values({
      tenantId: currentCreateTenantId(),
      siteKey: generateSiteKey(),
      name: input.name,
      appId: input.appId,
      allowedOrigins: normalizeOrigins(input.allowedOrigins),
      dailyEventQuota: input.dailyEventQuota ?? null,
      status: input.status ?? 'enabled',
      remark: input.remark ?? null,
    }).returning();
    invalidateSiteCache();
    return mapSite(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点 Key 已存在');
    throw err;
  }
}

export async function updateSite(id: number, input: UpdateAnalyticsSiteInput) {
  const current = await ensureSiteExists(id);
  try {
    const [row] = await db.update(analyticsSites).set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.appId !== undefined ? { appId: input.appId } : {}),
      ...(input.allowedOrigins !== undefined ? { allowedOrigins: normalizeOrigins(input.allowedOrigins) } : {}),
      ...(input.dailyEventQuota !== undefined ? { dailyEventQuota: input.dailyEventQuota } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.remark !== undefined ? { remark: input.remark } : {}),
    }).where(eq(analyticsSites.id, id)).returning();
    invalidateSiteCache(current.siteKey);
    return mapSite(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点 Key 已存在');
    throw err;
  }
}

export async function deleteSite(id: number): Promise<void> {
  const current = await ensureSiteExists(id);
  await db.delete(analyticsSites).where(eq(analyticsSites.id, id));
  invalidateSiteCache(current.siteKey);
}

export async function regenerateSiteKey(id: number) {
  const current = await ensureSiteExists(id);
  try {
    const [row] = await db.update(analyticsSites).set({ siteKey: generateSiteKey() }).where(eq(analyticsSites.id, id)).returning();
    invalidateSiteCache(current.siteKey);
    invalidateSiteCache(row.siteKey);
    return mapSite(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点 Key 已存在，请重试');
    throw err;
  }
}

async function resolveSiteByKeyUncached(siteKey: string): Promise<ResolvedAnalyticsSite | null> {
  const [row] = await db.select({
    id: analyticsSites.id,
    tenantId: analyticsSites.tenantId,
    appId: analyticsSites.appId,
    status: analyticsSites.status,
    allowedOrigins: analyticsSites.allowedOrigins,
    dailyEventQuota: analyticsSites.dailyEventQuota,
  }).from(analyticsSites).where(and(eq(analyticsSites.siteKey, siteKey), eq(analyticsSites.status, 'enabled'))).limit(1);
  if (!row) return null;
  return { ...row, allowedOrigins: row.allowedOrigins ?? null };
}

export async function resolveSiteByKey(siteKey: string | null | undefined): Promise<ResolvedAnalyticsSite | null> {
  const key = siteKey?.trim();
  if (!key) return null;
  // 廉价格式门槛：非 zk_ 前缀或超长的垃圾 key 直接拒绝，不占缓存也不打 DB
  if (!key.startsWith('zk_') || key.length > 64) return null;
  const now = Date.now();
  const cached = siteCache.get(key);
  if (cached && now - cached.fetchedAt < SITE_CACHE_TTL_MS) return cached.value;
  let loading = loadingByKey.get(key);
  if (!loading) {
    loading = resolveSiteByKeyUncached(key)
      .then((value) => {
        // 简易 LRU：命中上限时淘汰最早插入的条目（Map 保持插入序）
        if (!siteCache.has(key) && siteCache.size >= SITE_CACHE_MAX_ENTRIES) {
          const oldest = siteCache.keys().next().value;
          if (oldest !== undefined) siteCache.delete(oldest);
        }
        siteCache.set(key, { fetchedAt: Date.now(), value });
        return value;
      })
      .finally(() => { loadingByKey.delete(key); });
    loadingByKey.set(key, loading);
  }
  return loading;
}

export function __resetAnalyticsSiteCacheForTest(): void {
  invalidateSiteCache();
}
