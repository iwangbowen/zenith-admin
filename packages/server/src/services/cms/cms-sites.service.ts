import { eq, asc, and, or, like, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSites, cmsChannels, cmsSiteUsers, users } from '../../db/schema';
import type { CmsSiteRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUserOrNull } from '../../lib/context';
import { isSuperAdmin } from '../../lib/permissions';
import type { CreateCmsSiteInput, UpdateCmsSiteInput } from '@zenith/shared';

// ─── 站点配置内存缓存（前台按 Host 高频查找；写操作后失效）──────────────────────
let siteCache: { byHost: Map<string, CmsSiteRow>; byCode: Map<string, CmsSiteRow>; defaultSite: CmsSiteRow | null; loadedAt: number } | null = null;
const SITE_CACHE_TTL_MS = 30_000;

export function invalidateSiteCache(): void {
  siteCache = null;
}

async function loadSiteCache() {
  const rows = await db.select().from(cmsSites).where(eq(cmsSites.status, 'enabled'));
  const byHost = new Map<string, CmsSiteRow>();
  const byCode = new Map<string, CmsSiteRow>();
  let defaultSite: CmsSiteRow | null = null;
  for (const row of rows) {
    byCode.set(row.code, row);
    if (row.domain) byHost.set(row.domain.toLowerCase(), row);
    for (const alias of row.aliasDomains ?? []) {
      if (alias) byHost.set(alias.toLowerCase(), row);
    }
    if (row.isDefault && !defaultSite) defaultSite = row;
  }
  siteCache = { byHost, byCode, defaultSite, loadedAt: Date.now() };
  return siteCache;
}

async function getSiteCache() {
  if (siteCache && Date.now() - siteCache.loadedAt < SITE_CACHE_TTL_MS) return siteCache;
  return loadSiteCache();
}

/** 前台按 Host 匹配站点（域名/别名域名精确匹配，miss 回退默认站点） */
export async function resolveSiteByHost(host: string | undefined): Promise<CmsSiteRow | null> {
  const cache = await getSiteCache();
  if (host) {
    const hostname = host.split(':')[0].toLowerCase();
    const hit = cache.byHost.get(hostname);
    if (hit) return hit;
  }
  return cache.defaultSite;
}

/** 预览模式按 code 匹配站点 */
export async function resolveSiteByCode(code: string): Promise<CmsSiteRow | null> {
  const cache = await getSiteCache();
  return cache.byCode.get(code) ?? null;
}

// ─── 站点级数据权限 ────────────────────────────────────────────────────────────
// 策略：用户在 cms_site_users 中存在绑定 → 仅可管理绑定站点；未绑定/超管 → 不受限。

/** 当前用户可管理的站点 id 集合；null = 不受限 */
export async function getAccessibleSiteIds(): Promise<number[] | null> {
  const user = currentUserOrNull();
  if (!user || isSuperAdmin(user)) return null;
  const rows = await db.select({ siteId: cmsSiteUsers.siteId }).from(cmsSiteUsers).where(eq(cmsSiteUsers.userId, user.userId));
  if (rows.length === 0) return null;
  return rows.map((r) => r.siteId);
}

/** 站点访问断言：绑定用户操作非授权站点时抛 403（各 CMS service 写入口调用） */
export async function assertSiteAccess(siteId: number): Promise<void> {
  const ids = await getAccessibleSiteIds();
  if (ids && !ids.includes(siteId)) {
    throw new HTTPException(403, { message: '无权管理该站点' });
  }
}

/** 站点授权用户列表 */
export async function getCmsSiteUsers(siteId: number) {
  await ensureCmsSiteExists(siteId);
  const rows = await db.query.cmsSiteUsers.findMany({
    where: eq(cmsSiteUsers.siteId, siteId),
    with: { user: { columns: { id: true, username: true, nickname: true } } },
  });
  return {
    userIds: rows.map((r) => r.userId),
    users: rows.map((r) => ({ id: r.user.id, username: r.user.username, nickname: r.user.nickname })),
  };
}

/** 原子替换站点授权用户 */
export async function setCmsSiteUsers(siteId: number, userIds: number[]) {
  await ensureCmsSiteExists(siteId);
  if (userIds.length > 0) {
    const valid = await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds));
    if (valid.length !== userIds.length) throw new HTTPException(400, { message: '存在无效用户' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(cmsSiteUsers).where(eq(cmsSiteUsers.siteId, siteId));
    if (userIds.length > 0) {
      await tx.insert(cmsSiteUsers).values(userIds.map((userId) => ({ siteId, userId })));
    }
  });
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsSite(row: CmsSiteRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    domain: row.domain ?? null,
    aliasDomains: row.aliasDomains ?? [],
    isDefault: row.isDefault,
    title: row.title ?? null,
    keywords: row.keywords ?? null,
    description: row.description ?? null,
    logo: row.logo ?? null,
    favicon: row.favicon ?? null,
    icp: row.icp ?? null,
    copyright: row.copyright ?? null,
    theme: row.theme,
    staticMode: row.staticMode,
    robots: row.robots ?? null,
    settings: row.settings ?? {},
    status: row.status,
    sort: row.sort,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsSiteExists(id: number): Promise<CmsSiteRow> {
  const [row] = await db.select().from(cmsSites).where(eq(cmsSites.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  return row;
}

export async function getCmsSite(id: number) {
  return mapCmsSite(await ensureCmsSiteExists(id));
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsSitesQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsSites(q: ListCmsSitesQuery) {
  const { keyword = '', status, page, pageSize } = q;
  const conditions: SQL[] = [];
  const accessible = await getAccessibleSiteIds();
  if (accessible) conditions.push(inArray(cmsSites.id, accessible));
  if (keyword) {
    const kw = or(
      like(cmsSites.name, `%${escapeLike(keyword)}%`),
      like(cmsSites.code, `%${escapeLike(keyword)}%`),
      like(cmsSites.domain, `%${escapeLike(keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  if (status) conditions.push(eq(cmsSites.status, status));

  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsSites, where),
    withPagination(
      db.select().from(cmsSites).where(where).orderBy(asc(cmsSites.sort), asc(cmsSites.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: list.map(mapCmsSite), total, page, pageSize };
}

/** 全部启用站点（下拉选择/站点切换器用，绑定用户仅见授权站点） */
export async function listAllCmsSites() {
  const accessible = await getAccessibleSiteIds();
  const where = accessible
    ? and(eq(cmsSites.status, 'enabled'), inArray(cmsSites.id, accessible))
    : eq(cmsSites.status, 'enabled');
  const rows = await db.select().from(cmsSites)
    .where(where)
    .orderBy(asc(cmsSites.sort), asc(cmsSites.id));
  return rows.map(mapCmsSite);
}

/** isDefault 全局唯一：创建/更新事务内先清除旧默认标记（见 create/update） */

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsSite(data: CreateCmsSiteInput) {
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(cmsSites).set({ isDefault: false }).where(eq(cmsSites.isDefault, true));
      }
      const [created] = await tx.insert(cmsSites).values({
        ...data,
        domain: data.domain?.trim() ? data.domain.trim().toLowerCase() : null,
        aliasDomains: (data.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean),
      }).returning();
      return created;
    });
    invalidateSiteCache();
    return mapCmsSite(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点标识或域名已存在');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsSite(id: number, data: UpdateCmsSiteInput) {
  await assertSiteAccess(id);
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(cmsSites).set({ isDefault: false }).where(eq(cmsSites.isDefault, true));
      }
      const patch: Record<string, unknown> = { ...data };
      if (data.domain !== undefined) patch.domain = data.domain?.trim() ? data.domain.trim().toLowerCase() : null;
      if (data.aliasDomains !== undefined) patch.aliasDomains = (data.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
      const [updated] = await tx.update(cmsSites).set(patch).where(eq(cmsSites.id, id)).returning();
      if (!updated) throw new HTTPException(404, { message: '站点不存在' });
      return updated;
    });
    invalidateSiteCache();
    return mapCmsSite(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点标识或域名已存在');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsSite(id: number) {
  await assertSiteAccess(id);
  const channelCount = await db.$count(cmsChannels, eq(cmsChannels.siteId, id));
  if (channelCount > 0) {
    throw new HTTPException(400, { message: `该站点下存在 ${channelCount} 个栏目，请先删除栏目` });
  }
  const [row] = await db.delete(cmsSites).where(eq(cmsSites.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  invalidateSiteCache();
}
