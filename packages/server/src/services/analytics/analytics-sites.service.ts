
import { randomBytes } from 'node:crypto';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { analyticsSiteContract } from '@zenith/shared/analytics';
import type { CreateAnalyticsSiteInput, UpdateAnalyticsSiteInput } from '@zenith/shared/analytics';
import { db } from '../../db';
import { analyticsSites, userEvents } from '../../db/schema';
import type { AnalyticsSiteRow } from '../../db/schema';
import { formatDate, formatTimestamps, parseDateRangeStart } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { currentCreateTenantId, tenantScope } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';

const SITE_CACHE_TTL_MS = 60_000;
// siteKey 是匿名入口的用户可控输入：负缓存条目也会入 Map，必须设上限防止随机 key 灌爆内存
const SITE_CACHE_MAX_ENTRIES = 500;

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
    ...formatTimestamps(row),
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

export async function listSites(q: QueryOutputOf<typeof analyticsSiteContract.sites>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.name, [analyticsSites.name], 'ilike'),
    q.appId ? eq(analyticsSites.appId, q.appId) : undefined,
    q.status ? eq(analyticsSites.status, q.status) : undefined,
    tenantScope(analyticsSites),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(analyticsSites, where),
    rows: async () => {
      const list = await db.query.analyticsSites.findMany({ where, with: { tenant: true }, orderBy: [desc(analyticsSites.id)], limit: pageSize, offset: pageOffset(page, pageSize) });
      // 今日用量按 appId 实时统计（含登录态事件）：Redis 配额计数器只覆盖带配额的匿名站点，
      // 默认站点（admin/member，无 siteKey 采集路径）在计数器里恒为 0，直接查事件表才是真实用量
      const appIds = [...new Set(list.map((site) => site.appId))];
      const todayStart = parseDateRangeStart(formatDate(new Date())) ?? new Date();
      const usageRows = appIds.length > 0
        ? await db
          .select({ appId: userEvents.appId, n: sql<number>`COUNT(*)::int` })
          .from(userEvents)
          .where(and(inArray(userEvents.appId, appIds), gte(userEvents.createdAt, todayStart)))
          .groupBy(userEvents.appId)
        : [];
      const usageByAppId = new Map(usageRows.map((r) => [r.appId, Number(r.n)]));
      return list.map((site) => ({ ...mapSite(site), todayUsage: usageByAppId.get(site.appId) ?? 0 }));
    },
  });
}

async function ensureSiteExists(id: number): Promise<AnalyticsSiteRow> {
  const where = buildWhere(eq(analyticsSites.id, id), tenantScope(analyticsSites));
  return requireFirstRow(db.select().from(analyticsSites).where(where).limit(1), '站点不存在');
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
