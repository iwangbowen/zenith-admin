import { eq, asc, and, or, like, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSites, cmsChannels, cmsSiteUsers, users } from '../../db/schema';
import type { CmsSiteRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser } from '../../lib/context';
import type { CreateCmsSiteInput, UpdateCmsSiteInput } from '@zenith/shared';
import { assertSiteTemplateSettings, assertSiteThemeConfig } from './cms-template-refs.service';
import { isCmsPlatformAdmin } from './cms-access';
import {
  mergeCmsSiteSettings, normalizeNewCmsSiteSettings, redactCmsSiteSettings,
} from './cms-site-settings';
import { cmsCdnPurgeHostAllowlist, validateCdnPurgeEndpoint } from './cms-cdn-policy';

function assertCdnPurgeSetting(settings: Record<string, unknown>): void {
  const rawUrl = typeof settings.cdnPurgeUrl === 'string' ? settings.cdnPurgeUrl.trim() : '';
  if (!rawUrl) return;
  try {
    validateCdnPurgeEndpoint(rawUrl, cmsCdnPurgeHostAllowlist());
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : 'CDN purge URL 配置无效',
    });
  }
}

// ─── 站点配置内存缓存（前台按 Host 高频查找；写操作后失效）──────────────────────
let siteCache: { byHost: Map<string, CmsSiteRow>; byId: Map<number, CmsSiteRow>; byCode: Map<string, CmsSiteRow>; defaultSite: CmsSiteRow | null; loadedAt: number } | null = null;
const SITE_CACHE_TTL_MS = 30_000;

export function invalidateSiteCache(): void {
  siteCache = null;
}

async function loadSiteCache() {
  const rows = await db.select().from(cmsSites)
    .where(eq(cmsSites.status, 'enabled'))
    .orderBy(asc(cmsSites.sort), asc(cmsSites.id));
  const byHost = new Map<string, CmsSiteRow>();
  const byId = new Map<number, CmsSiteRow>();
  const byCode = new Map<string, CmsSiteRow>();
  let defaultSite: CmsSiteRow | null = null;
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, row);
    byId.set(row.id, row);
    if (row.domain && !byHost.has(row.domain.toLowerCase())) byHost.set(row.domain.toLowerCase(), row);
    for (const alias of row.aliasDomains ?? []) {
      if (alias && !byHost.has(alias.toLowerCase())) byHost.set(alias.toLowerCase(), row);
    }
    if (row.isDefault && !defaultSite) defaultSite = row;
  }
  siteCache = { byHost, byId, byCode, defaultSite, loadedAt: Date.now() };
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

/** 前台按 id 取启用站点（发布通道独立域名命中后取所属站点） */
export async function resolveSiteById(id: number): Promise<CmsSiteRow | null> {
  const cache = await getSiteCache();
  return cache.byId.get(id) ?? null;
}

/** 预览模式按 code 匹配站点 */
export async function resolveSiteByCode(code: string): Promise<CmsSiteRow | null> {
  const cache = await getSiteCache();
  return cache.byCode.get(code) ?? null;
}

// ─── 站点级数据权限 ────────────────────────────────────────────────────────────
// 策略：非平台超管必须在 cms_site_users 中显式绑定；平台超管可绕过。

/** 当前用户可管理的站点 id 集合；null = 不受限 */
export async function getAccessibleSiteIds(): Promise<number[] | null> {
  const user = currentUser();
  if (isCmsPlatformAdmin(user)) return null;
  const rows = await db.select({ siteId: cmsSiteUsers.siteId }).from(cmsSiteUsers)
    .where(eq(cmsSiteUsers.userId, user.userId));
  return rows.map((r) => r.siteId);
}

/** 站点访问断言：非平台超管没有显式站点绑定时拒绝。 */
export async function assertSiteAccess(siteId: number): Promise<void> {
  await ensureCmsSiteExists(siteId);
  const ids = await getAccessibleSiteIds();
  if (ids !== null && !ids.includes(siteId)) {
    throw new HTTPException(403, { message: '无权管理该站点' });
  }
}

/** 站点授权用户列表 */
async function loadCmsSiteUsers(site: CmsSiteRow) {
  const rows = await db.query.cmsSiteUsers.findMany({
    where: eq(cmsSiteUsers.siteId, site.id),
    with: { user: { columns: { id: true, username: true, nickname: true } } },
  });
  return {
    userIds: rows.map((r) => r.userId),
    users: rows.map((r) => ({ id: r.user.id, username: r.user.username, nickname: r.user.nickname })),
  };
}

export async function getCmsSiteUsers(siteId: number) {
  const site = await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  return loadCmsSiteUsers(site);
}

/** 原子替换站点授权用户 */
export async function setCmsSiteUsers(siteId: number, userIds: number[]) {
  const site = await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    const valid = await db.select({ id: users.id }).from(users).where(inArray(users.id, unique));
    if (valid.length !== unique.length) throw new HTTPException(400, { message: '存在无效用户' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(cmsSiteUsers).where(and(
      eq(cmsSiteUsers.siteId, siteId),
    ));
    if (unique.length > 0) {
      await tx.insert(cmsSiteUsers).values(unique.map((userId) => ({
        siteId,
        userId,
      })));
    }
  });
  return loadCmsSiteUsers(site);
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
    settings: redactCmsSiteSettings(row.settings),
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
  await assertSiteAccess(id);
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
  if (accessible !== null) conditions.push(inArray(cmsSites.id, accessible));
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
  const conditions: SQL[] = [eq(cmsSites.status, 'enabled')];
  if (accessible !== null) conditions.push(inArray(cmsSites.id, accessible));
  const where = and(...conditions);
  const rows = await db.select().from(cmsSites)
    .where(where)
    .orderBy(asc(cmsSites.sort), asc(cmsSites.id));
  return rows.map(mapCmsSite);
}

/** isDefault 全局唯一：创建/更新事务内先清除旧默认标记（见 create/update） */

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsSite(data: CreateCmsSiteInput) {
  const user = currentUser();
  const platformAdmin = isCmsPlatformAdmin(user);
  const settings = normalizeNewCmsSiteSettings(data.settings as Record<string, unknown> | undefined);
  assertCdnPurgeSetting(settings);
  assertSiteTemplateSettings(data.theme ?? 'default', settings);
  assertSiteThemeConfig(data.theme ?? 'default', settings);
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(cmsSites).set({ isDefault: false }).where(and(
          eq(cmsSites.isDefault, true),
        ));
      }
      const [created] = await tx.insert(cmsSites).values({
        ...data,
        settings,
        domain: data.domain?.trim() ? data.domain.trim().toLowerCase() : null,
        aliasDomains: (data.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean),
      }).returning();
      if (!platformAdmin) {
        await tx.insert(cmsSiteUsers).values({ siteId: created.id, userId: user.userId });
      }
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
  const current = await ensureCmsSiteExists(id);
  const settings = data.settings === undefined
    ? current.settings
    : mergeCmsSiteSettings(current.settings, data.settings as Record<string, unknown>);
  // 模板引用/主题参数校验：提交的配置须匹配生效主题（theme 未变更时取当前值）
  if (data.settings !== undefined) {
    assertCdnPurgeSetting(settings);
    const theme = data.theme ?? current.theme;
    assertSiteTemplateSettings(theme, settings);
    assertSiteThemeConfig(theme, settings);
  }
  try {
    const row = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(cmsSites).set({ isDefault: false }).where(and(
          eq(cmsSites.isDefault, true),
        ));
      }
      const patch: Record<string, unknown> = { ...data };
      if (data.settings !== undefined) patch.settings = settings;
      if (data.domain !== undefined) patch.domain = data.domain?.trim() ? data.domain.trim().toLowerCase() : null;
      if (data.aliasDomains !== undefined) patch.aliasDomains = (data.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
      const [updated] = await tx.update(cmsSites).set(patch).where(and(
        eq(cmsSites.id, id),
      )).returning();
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
  await ensureCmsSiteExists(id);
  const channelCount = await db.$count(cmsChannels, and(
    eq(cmsChannels.siteId, id),
  ));
  if (channelCount > 0) {
    throw new HTTPException(400, { message: `该站点下存在 ${channelCount} 个栏目，请先删除栏目` });
  }
  const [row] = await db.delete(cmsSites).where(and(
    eq(cmsSites.id, id),
  )).returning();
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  invalidateSiteCache();
}

// ─── 行为统计开通（P3：关联 analytics_sites，前台注入采集 beacon）───────────────
export async function enableSiteAnalytics(siteId: number) {
  await assertSiteAccess(siteId);
  const site = await ensureCmsSiteExists(siteId);
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  if (typeof settings.analyticsSiteKey === 'string' && settings.analyticsSiteKey) {
    return { siteKey: settings.analyticsSiteKey, created: false };
  }
  const { createSite } = await import('../analytics/analytics-sites.service');
  const origins: string[] = [];
  if (site.domain) origins.push(`https://${site.domain}`, `http://${site.domain}`);
  for (const alias of site.aliasDomains ?? []) {
    if (alias) origins.push(`https://${alias}`, `http://${alias}`);
  }
  const analyticsSite = await createSite({
    name: `CMS：${site.name}`,
    appId: `cms-${site.code}`,
    allowedOrigins: origins,
    status: 'enabled',
    remark: `CMS 站点「${site.name}」自动创建`,
  });
  await db.update(cmsSites)
    .set({ settings: { ...settings, analyticsSiteKey: analyticsSite.siteKey } })
    .where(eq(cmsSites.id, siteId));
  invalidateSiteCache();
  return { siteKey: analyticsSite.siteKey, created: true };
}
