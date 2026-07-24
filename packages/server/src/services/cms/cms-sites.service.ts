import { eq, asc, and, or, like, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsSites,
  cmsChannels,
  cmsDistributionRules,
  cmsSiteInheritances,
  cmsSiteUsers,
  users,
} from '../../db/schema';
import type { CmsSiteInheritanceRow, CmsSiteRow } from '../../db/schema';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser, hasPermission } from '../../lib/context';
import {
  CMS_SITE_INHERITABLE_FIELDS,
  CMS_SITE_MAX_DEPTH,
  type AsyncTask,
  type CmsSiteInheritableField,
  type CmsSiteInheritanceFlags,
  type CreateCmsSiteInput,
  type UpdateCmsSiteInput,
} from '@zenith/shared';
import { assertSiteTemplateSettings, assertSiteThemeConfig } from './cms-template-refs.service';
import { isCmsPlatformAdmin } from './cms-access';
import {
  mergeCmsSiteSettings, normalizeNewCmsSiteSettings, redactCmsSiteSettings,
} from './cms-site-settings';
import { cmsCdnPurgeHostAllowlist, validateCdnPurgeEndpoint } from './cms-cdn-policy';
import { isThemeRegistered } from '../../cms/themes/registry';
import { lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import {
  DEFAULT_CMS_SITE_INHERITANCE,
  buildCmsSiteChain,
  getCmsSiteEffectiveConfig,
  listCmsSubtreeIds,
  loadCmsInheritanceState,
  resolveCmsSiteSnapshot,
} from './cms-site-inheritance.service';
import { planCmsSiteMove, validateCmsSiteEnablement } from './cms-site-hierarchy-policy';

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
  const [allRows, inheritances] = await Promise.all([
    db.select().from(cmsSites).orderBy(asc(cmsSites.sort), asc(cmsSites.id)),
    db.select().from(cmsSiteInheritances),
  ]);
  const rows = allRows
    .filter((row) => row.status === 'enabled')
    .filter((row) => buildCmsSiteChain(allRows, row.id).every((ancestor) => ancestor.status === 'enabled'))
    .map((row) => resolveCmsSiteSnapshot(allRows, inheritances, row.id).site);
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

/** 完整批量 ACL：任一目标不可见即整体拒绝，禁止站群操作静默裁剪。 */
export async function assertSitesAccess(siteIds: readonly number[]): Promise<void> {
  const unique = [...new Set(siteIds)];
  const accessible = await getAccessibleSiteIds();
  if (accessible === null) return;
  const allowed = new Set(accessible);
  if (unique.some((id) => !allowed.has(id))) {
    throw new HTTPException(403, { message: '站群操作要求对全部目标站点具有显式权限' });
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
interface CmsSiteMapMeta {
  parentId?: number | null;
  parentName?: string | null;
  depth?: number;
  hasChildren?: boolean;
  inheritance?: CmsSiteInheritanceFlags;
  effectiveTheme?: string;
  effectiveStaticMode?: CmsSiteRow['staticMode'];
}

export function mapCmsSite(row: CmsSiteRow, meta: CmsSiteMapMeta = {}) {
  return {
    id: row.id,
    parentId: meta.parentId === undefined ? row.parentId ?? null : meta.parentId,
    parentName: meta.parentName,
    depth: meta.depth,
    hasChildren: meta.hasChildren,
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
    effectiveTheme: meta.effectiveTheme,
    themeRevision: row.themeRevision,
    templateRefsRevision: row.templateRefsRevision,
    staticMode: row.staticMode,
    effectiveStaticMode: meta.effectiveStaticMode,
    robots: row.robots ?? null,
    settings: redactCmsSiteSettings(row.settings),
    status: row.status,
    sort: row.sort,
    remark: row.remark ?? null,
    inheritance: meta.inheritance,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function inheritanceFlags(row: CmsSiteInheritanceRow | undefined): CmsSiteInheritanceFlags {
  if (!row) return { ...DEFAULT_CMS_SITE_INHERITANCE };
  return Object.fromEntries(CMS_SITE_INHERITABLE_FIELDS.map((field) => [field, row[field]])) as unknown as CmsSiteInheritanceFlags;
}

function mapCmsSiteRows(
  rows: readonly CmsSiteRow[],
  allRows: readonly CmsSiteRow[],
  inheritanceRows: readonly CmsSiteInheritanceRow[],
  visibleSiteIds: number[] | null,
) {
  const allById = new Map(allRows.map((row) => [row.id, row]));
  const flagsById = new Map(inheritanceRows.map((row) => [row.siteId, row]));
  const childCounts = new Map<number, number>();
  for (const row of allRows) {
    if (row.parentId != null) childCounts.set(row.parentId, (childCounts.get(row.parentId) ?? 0) + 1);
  }
  const visible = visibleSiteIds == null ? null : new Set(visibleSiteIds);
  return rows.map((row) => {
    const parentVisible = row.parentId == null || visible == null || visible.has(row.parentId);
    const effective = resolveCmsSiteSnapshot(allRows, inheritanceRows, row.id).site;
    return mapCmsSite(row, {
      parentId: parentVisible ? row.parentId : null,
      parentName: parentVisible && row.parentId != null ? allById.get(row.parentId)?.name ?? null : null,
      depth: buildCmsSiteChain(allRows, row.id).length,
      hasChildren: (childCounts.get(row.id) ?? 0) > 0,
      inheritance: inheritanceFlags(flagsById.get(row.id)),
      effectiveTheme: effective.theme,
      effectiveStaticMode: effective.staticMode,
    });
  });
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsSiteExists(id: number): Promise<CmsSiteRow> {
  const [row] = await db.select().from(cmsSites).where(eq(cmsSites.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '站点不存在' });
  return row;
}

export async function getCmsSite(id: number) {
  await assertSiteAccess(id);
  const state = await loadCmsInheritanceState();
  const visible = await getAccessibleSiteIds();
  const [mapped] = mapCmsSiteRows(
    state.sites.filter((row) => row.id === id),
    state.sites,
    state.inheritances,
    visible,
  );
  if (!mapped) throw new HTTPException(404, { message: '站点不存在' });
  return mapped;
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
  const [allRows, inheritanceRows] = await Promise.all([
    db.select().from(cmsSites),
    db.select().from(cmsSiteInheritances),
  ]);
  return { list: mapCmsSiteRows(list, allRows, inheritanceRows, accessible), total, page, pageSize };
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
  const [allRows, inheritanceRows] = await Promise.all([
    db.select().from(cmsSites),
    db.select().from(cmsSiteInheritances),
  ]);
  return mapCmsSiteRows(rows, allRows, inheritanceRows, accessible);
}

export async function listCmsSiteTree(query: { keyword?: string; status?: 'enabled' | 'disabled' }) {
  const accessible = await getAccessibleSiteIds();
  const conditions: SQL[] = [];
  if (accessible !== null) conditions.push(inArray(cmsSites.id, accessible));
  if (query.keyword?.trim()) {
    const keyword = `%${escapeLike(query.keyword.trim())}%`;
    conditions.push(or(
      like(cmsSites.name, keyword),
      like(cmsSites.code, keyword),
      like(cmsSites.domain, keyword),
    )!);
  }
  if (query.status) conditions.push(eq(cmsSites.status, query.status));
  const [rows, allRows, inheritanceRows] = await Promise.all([
    db.select().from(cmsSites).where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(cmsSites.sort), asc(cmsSites.id)),
    db.select().from(cmsSites),
    db.select().from(cmsSiteInheritances),
  ]);
  const mapped = mapCmsSiteRows(rows, allRows, inheritanceRows, accessible);
  const byId = new Map(mapped.map((row) => [row.id, { ...row, children: [] as typeof mapped }]));
  const roots: Array<(typeof mapped)[number] & { children: typeof mapped }> = [];
  for (const row of byId.values()) {
    const parent = row.parentId == null ? null : byId.get(row.parentId);
    if (parent) parent.children.push(row);
    else roots.push(row);
  }
  const prune = (items: typeof roots): void => {
    for (const item of items) {
      if (item.children.length) prune(item.children as typeof roots);
      else delete (item as { children?: unknown }).children;
    }
  };
  prune(roots);
  return roots;
}

export async function getCmsSiteInheritanceChain(siteId: number) {
  await assertSiteAccess(siteId);
  const state = await loadCmsInheritanceState();
  const accessible = await getAccessibleSiteIds();
  const visible = accessible == null ? null : new Set(accessible);
  return buildCmsSiteChain(state.sites, siteId)
    .reverse()
    .filter((row) => visible == null || visible.has(row.id))
    .map((row, index) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      code: row.code,
      depth: index + 1,
      status: row.status,
    }));
}

export async function getCmsEffectiveConfig(siteId: number) {
  await assertSiteAccess(siteId);
  return getCmsSiteEffectiveConfig(siteId, await getAccessibleSiteIds());
}

/** isDefault 全局唯一：创建/更新事务内先清除旧默认标记（见 create/update） */

function changedInheritanceFields(data: UpdateCmsSiteInput): CmsSiteInheritableField[] {
  const fields = new Set<CmsSiteInheritableField>();
  if (data.title !== undefined) fields.add('seoTitle');
  if (data.keywords !== undefined) fields.add('seoKeywords');
  if (data.description !== undefined) fields.add('seoDescription');
  if (data.staticMode !== undefined) fields.add('staticMode');
  if (data.settings !== undefined) {
    fields.add('reviewMode');
    fields.add('webhook');
    fields.add('cdn');
    fields.add('themeConfig');
    fields.add('templates');
  }
  return [...fields];
}

async function insertEffectiveConfigRebuildTasks(
  tx: DbTransaction,
  sourceSiteId: number,
  fields: readonly CmsSiteInheritableField[],
  reason: string,
): Promise<AsyncTask[]> {
  if (!fields.length) return [];
  const state = await loadCmsInheritanceState(tx);
  const affectedIds = state.sites
    .filter((site) => site.status === 'enabled')
    .filter((site) => {
      const snapshot = resolveCmsSiteSnapshot(state.sites, state.inheritances, site.id);
      return fields.some((field) => snapshot.sourceSiteIds[field] === sourceSiteId);
    })
    .map((site) => site.id)
    .sort((a, b) => a - b);
  const tasks: AsyncTask[] = [];
  for (const siteId of affectedIds) {
    const [site] = await tx.update(cmsSites).set({
      templateRefsRevision: sql`${cmsSites.templateRefsRevision} + 1`,
    }).where(eq(cmsSites.id, siteId)).returning();
    if (!site) continue;
    tasks.push(await insertCmsSiteRefsRebuildOutbox(
      tx,
      site,
      reason,
      `site:${siteId}:effective-config:${site.templateRefsRevision}`,
    ));
  }
  return tasks;
}

async function assertCmsRebuildTargetsAccess(siteIds: readonly number[]): Promise<void> {
  await assertSitesAccess(siteIds);
  const { assertAllCmsSiteChannelsAccess } = await import('./cms-channels.service');
  for (const siteId of [...new Set(siteIds)].sort((a, b) => a - b)) {
    await assertAllCmsSiteChannelsAccess(siteId);
  }
}

async function assertNoEnabledDistributionRules(executor: DbExecutor, siteId: number): Promise<void> {
  const count = await executor.$count(cmsDistributionRules, and(
    eq(cmsDistributionRules.status, 'enabled'),
    or(
      eq(cmsDistributionRules.sourceSiteId, siteId),
      eq(cmsDistributionRules.targetSiteId, siteId),
    ),
  ));
  if (count > 0) {
    throw new HTTPException(400, { message: `该站点被 ${count} 条启用中的分发规则引用，请先停用规则` });
  }
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsSite(data: CreateCmsSiteInput) {
  const user = currentUser();
  const platformAdmin = isCmsPlatformAdmin(user);
  const {
    parentId = null,
    inheritance: requestedInheritance = DEFAULT_CMS_SITE_INHERITANCE,
    ...siteData
  } = data;
  if (parentId != null) {
    if (!(await hasPermission('cms:site:hierarchy'))) {
      throw new HTTPException(403, { message: '创建子站点需要 cms:site:hierarchy 权限' });
    }
    await assertSiteAccess(parentId);
  }
  const hierarchyRows = await db.select({
    id: cmsSites.id,
    parentId: cmsSites.parentId,
    status: cmsSites.status,
  }).from(cmsSites);
  try {
    planCmsSiteMove(
      [...hierarchyRows, { id: -1, parentId: null, status: siteData.status ?? 'enabled' }],
      -1,
      parentId,
    );
    if ((siteData.status ?? 'enabled') === 'enabled' && parentId != null) {
      const parent = hierarchyRows.find((row) => row.id === parentId);
      if (parent?.status !== 'enabled') throw new Error('父站点已停用，不能创建启用的子站点');
    }
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : '站点层级无效' });
  }
  const inheritance: CmsSiteInheritanceFlags = parentId == null
    ? { ...DEFAULT_CMS_SITE_INHERITANCE }
    : { ...DEFAULT_CMS_SITE_INHERITANCE, ...requestedInheritance };
  const settings = normalizeNewCmsSiteSettings(data.settings as Record<string, unknown> | undefined);
  if (!isThemeRegistered(siteData.theme ?? 'default')) {
    throw new HTTPException(400, { message: '新站点只能先选择内置主题；签名主题包请在站点创建后通过主题管理激活' });
  }
  assertCdnPurgeSetting(settings);
  await assertSiteTemplateSettings(siteData.theme ?? 'default', settings);
  assertSiteThemeConfig(siteData.theme ?? 'default', settings);
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
      const lockedHierarchy = await tx.select({
        id: cmsSites.id,
        parentId: cmsSites.parentId,
        status: cmsSites.status,
      }).from(cmsSites).orderBy(asc(cmsSites.id)).for('update');
      try {
        planCmsSiteMove(
          [...lockedHierarchy, { id: -1, parentId: null, status: siteData.status ?? 'enabled' }],
          -1,
          parentId,
        );
        if ((siteData.status ?? 'enabled') === 'enabled' && parentId != null) {
          const parent = lockedHierarchy.find((item) => item.id === parentId);
          if (parent?.status !== 'enabled') throw new Error('父站点已停用，不能创建启用的子站点');
        }
      } catch (error) {
        throw new HTTPException(400, { message: error instanceof Error ? error.message : '站点层级无效' });
      }
      if (siteData.isDefault) {
        await tx.update(cmsSites).set({ isDefault: false }).where(and(
          eq(cmsSites.isDefault, true),
        ));
      }
      const [created] = await tx.insert(cmsSites).values({
        ...siteData,
        parentId,
        settings,
        domain: siteData.domain?.trim() ? siteData.domain.trim().toLowerCase() : null,
        aliasDomains: (siteData.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean),
      }).returning();
      await tx.insert(cmsSiteInheritances).values({ siteId: created.id, ...inheritance });
      const state = await loadCmsInheritanceState(tx);
      const effective = resolveCmsSiteSnapshot(state.sites, state.inheritances, created.id).site;
      assertCdnPurgeSetting(effective.settings);
      await assertSiteTemplateSettings(effective.theme, effective.settings, created.id, tx);
      assertSiteThemeConfig(effective.theme, effective.settings);
      if (!platformAdmin) {
        await tx.insert(cmsSiteUsers).values({ siteId: created.id, userId: user.userId });
      }
      return created;
    });
    invalidateSiteCache();
    return getCmsSite(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点标识或域名已存在');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsSite(id: number, data: UpdateCmsSiteInput) {
  await assertSiteAccess(id);
  const current = await ensureCmsSiteExists(id);
  if (data.status === 'disabled' && current.status !== 'disabled') {
    await assertNoEnabledDistributionRules(db, id);
  }
  if (data.status && data.status !== current.status) {
    const rows = await db.select({
      id: cmsSites.id,
      parentId: cmsSites.parentId,
      status: cmsSites.status,
    }).from(cmsSites);
    try {
      validateCmsSiteEnablement(rows, id, data.status);
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : '站点状态与层级不兼容' });
    }
  }
  const changedFields = changedInheritanceFields(data);
  if (changedFields.length) {
    const state = await loadCmsInheritanceState();
    const affectedIds = state.sites
      .filter((site) => site.status === 'enabled')
      .filter((site) => {
        const snapshot = resolveCmsSiteSnapshot(state.sites, state.inheritances, site.id);
        return changedFields.some((field) => snapshot.sourceSiteIds[field] === id);
      })
      .map((site) => site.id);
    await assertCmsRebuildTargetsAccess(affectedIds);
  }
  const settings = data.settings === undefined
    ? current.settings
    : mergeCmsSiteSettings(current.settings, data.settings as Record<string, unknown>);
  // 模板引用/主题参数校验：普通站点更新始终按当前生效主题校验，theme 只允许生命周期接口修改。
  if (data.settings !== undefined) {
    const state = await loadCmsInheritanceState();
    const effective = resolveCmsSiteSnapshot(
      state.sites.map((site) => site.id === id ? { ...site, settings } : site),
      state.inheritances,
      id,
    ).site;
    assertCdnPurgeSetting(effective.settings);
    await assertSiteTemplateSettings(effective.theme, effective.settings, id);
    assertSiteThemeConfig(effective.theme, effective.settings);
  }
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-effective-config'))`);
      if (changedFields.length) {
        const state = await loadCmsInheritanceState(tx);
        const affectedIds = state.sites
          .filter((site) => site.status === 'enabled')
          .filter((site) => {
            const snapshot = resolveCmsSiteSnapshot(state.sites, state.inheritances, site.id);
            return changedFields.some((field) => snapshot.sourceSiteIds[field] === id);
          })
          .map((site) => site.id);
        await assertCmsRebuildTargetsAccess(affectedIds);
      }
      if (data.status && data.status !== current.status) {
        const hierarchy = await tx.select({
          id: cmsSites.id,
          parentId: cmsSites.parentId,
          status: cmsSites.status,
        }).from(cmsSites).orderBy(asc(cmsSites.id)).for('update');
        try {
          validateCmsSiteEnablement(hierarchy, id, data.status);
        } catch (error) {
          throw new HTTPException(400, { message: error instanceof Error ? error.message : '站点状态与层级不兼容' });
        }
        if (data.status === 'disabled') await assertNoEnabledDistributionRules(tx, id);
      }
      const locked = await lockCmsSiteForMutation(tx, id);
      const lockedSettings = data.settings === undefined
        ? locked.settings
        : mergeCmsSiteSettings(locked.settings, data.settings as Record<string, unknown>);
      if (data.settings !== undefined) {
        const state = await loadCmsInheritanceState(tx);
        const effective = resolveCmsSiteSnapshot(
          state.sites.map((site) => site.id === id ? { ...site, settings: lockedSettings } : site),
          state.inheritances,
          id,
        ).site;
        assertCdnPurgeSetting(effective.settings);
        await assertSiteTemplateSettings(effective.theme, effective.settings, id, tx);
        assertSiteThemeConfig(effective.theme, effective.settings);
      }
      if (data.isDefault) {
        await tx.update(cmsSites).set({ isDefault: false }).where(and(
          eq(cmsSites.isDefault, true),
        ));
      }
      const patch: Record<string, unknown> = {
        name: data.name,
        code: data.code,
        isDefault: data.isDefault,
        title: data.title,
        keywords: data.keywords,
        description: data.description,
        logo: data.logo,
        favicon: data.favicon,
        icp: data.icp,
        copyright: data.copyright,
        staticMode: data.staticMode,
        robots: data.robots,
        status: data.status,
        sort: data.sort,
        remark: data.remark,
      };
      if (data.settings !== undefined) {
        patch.settings = lockedSettings;
      }
      if (data.domain !== undefined) patch.domain = data.domain?.trim() ? data.domain.trim().toLowerCase() : null;
      if (data.aliasDomains !== undefined) patch.aliasDomains = (data.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
      const [updated] = await tx.update(cmsSites).set(patch).where(and(
        eq(cmsSites.id, id),
      )).returning();
      if (!updated) throw new HTTPException(404, { message: '站点不存在' });
      const tasks = await insertEffectiveConfigRebuildTasks(
        tx,
        id,
        changedFields,
        '站点有效配置更新',
      );
      return { updated, tasks };
    });
    invalidateSiteCache();
    if (row.tasks.length) await enqueueCmsPublishOutboxes(row.tasks, `站点 #${id} 配置更新`);
    return getCmsSite(row.updated.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '站点标识或域名已存在');
  }
}

export async function moveCmsSite(id: number, parentId: number | null) {
  await assertSiteAccess(id);
  if (parentId != null) await assertSiteAccess(parentId);
  const initialRows = await db.select({
    id: cmsSites.id,
    parentId: cmsSites.parentId,
    status: cmsSites.status,
  }).from(cmsSites);
  let initialPlan;
  try {
    initialPlan = planCmsSiteMove(initialRows, id, parentId);
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : '站点移动无效' });
  }
  await assertSitesAccess([...initialPlan.subtreeIds, ...(parentId == null ? [] : [parentId])]);
  await assertCmsRebuildTargetsAccess(initialPlan.subtreeIds);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
    const rows = await tx.select({
      id: cmsSites.id,
      parentId: cmsSites.parentId,
      status: cmsSites.status,
    }).from(cmsSites).orderBy(asc(cmsSites.id)).for('update');
    const current = rows.find((row) => row.id === id);
    if (!current) throw new HTTPException(404, { message: '站点不存在' });
    if (current.parentId === parentId) throw new HTTPException(409, { message: '站点已经位于所选父级下' });
    let plan;
    try {
      plan = planCmsSiteMove(rows, id, parentId);
      if (current.status === 'enabled' && parentId != null) {
        const parent = rows.find((row) => row.id === parentId);
        if (parent?.status !== 'enabled') throw new Error('不能把启用站点移动到已停用父站点下');
      }
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : '站点移动无效' });
    }
    await assertCmsRebuildTargetsAccess(plan.subtreeIds);
    await tx.update(cmsSites).set({ parentId }).where(eq(cmsSites.id, id));
    const movedState = await loadCmsInheritanceState(tx);
    for (const movedId of plan.subtreeIds) {
      const effective = resolveCmsSiteSnapshot(movedState.sites, movedState.inheritances, movedId).site;
      assertCdnPurgeSetting(effective.settings);
      await assertSiteTemplateSettings(effective.theme, effective.settings, movedId, tx);
      assertSiteThemeConfig(effective.theme, effective.settings);
    }
    const tasks: AsyncTask[] = [];
    for (const siteId of plan.subtreeIds.sort((a, b) => a - b)) {
      const [site] = await tx.update(cmsSites).set({
        themeRevision: sql`${cmsSites.themeRevision} + 1`,
        templateRefsRevision: sql`${cmsSites.templateRefsRevision} + 1`,
      }).where(eq(cmsSites.id, siteId)).returning();
      if (!site || site.status !== 'enabled') continue;
      tasks.push(await insertCmsSiteRefsRebuildOutbox(
        tx,
        site,
        '站点子树移动后有效配置重建',
        `site:${siteId}:hierarchy:${site.themeRevision}:${site.templateRefsRevision}`,
      ));
    }
    return { plan, tasks };
  });
  invalidateSiteCache();
  await enqueueCmsPublishOutboxes(result.tasks, `站点 #${id} 子树移动`);
  return {
    site: await getCmsSite(id),
    affectedSiteIds: result.plan.subtreeIds,
    maxDepth: CMS_SITE_MAX_DEPTH,
  };
}

export async function updateCmsSiteInheritance(
  siteId: number,
  patch: Partial<CmsSiteInheritanceFlags>,
) {
  await assertSiteAccess(siteId);
  const initialState = await loadCmsInheritanceState();
  const site = initialState.sites.find((row) => row.id === siteId);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  if (site.parentId == null && Object.values(patch).some(Boolean)) {
    throw new HTTPException(400, { message: '根站点没有父级，不能启用继承' });
  }
  const subtreeIds = listCmsSubtreeIds(initialState.sites, siteId);
  await assertCmsRebuildTargetsAccess(subtreeIds);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
    const hierarchyState = await loadCmsInheritanceState(tx);
    const affectedSiteIds = listCmsSubtreeIds(hierarchyState.sites, siteId);
    await assertCmsRebuildTargetsAccess(affectedSiteIds);
    const [current] = await tx.select().from(cmsSiteInheritances)
      .where(eq(cmsSiteInheritances.siteId, siteId)).for('update').limit(1);
    const next = { ...DEFAULT_CMS_SITE_INHERITANCE, ...inheritanceFlags(current), ...patch };
    await tx.insert(cmsSiteInheritances).values({
      siteId,
      ...next,
      revision: (current?.revision ?? 0) + 1,
    }).onConflictDoUpdate({
      target: cmsSiteInheritances.siteId,
      set: {
        ...next,
        revision: sql`${cmsSiteInheritances.revision} + 1`,
      },
    });
    const state = await loadCmsInheritanceState(tx);
    const effective = resolveCmsSiteSnapshot(state.sites, state.inheritances, siteId).site;
    assertCdnPurgeSetting(effective.settings);
    await assertSiteTemplateSettings(effective.theme, effective.settings, siteId, tx);
    assertSiteThemeConfig(effective.theme, effective.settings);
    const tasks: AsyncTask[] = [];
    for (const affectedId of affectedSiteIds.sort((a, b) => a - b)) {
      const [affected] = await tx.update(cmsSites).set({
        themeRevision: sql`${cmsSites.themeRevision} + 1`,
        templateRefsRevision: sql`${cmsSites.templateRefsRevision} + 1`,
      }).where(eq(cmsSites.id, affectedId)).returning();
      if (!affected || affected.status !== 'enabled') continue;
      tasks.push(await insertCmsSiteRefsRebuildOutbox(
        tx,
        affected,
        '站点继承策略更新',
        `site:${affected.id}:inheritance:${affected.themeRevision}:${affected.templateRefsRevision}`,
      ));
    }
    return { inheritance: next, tasks, affectedSiteIds };
  });
  invalidateSiteCache();
  await enqueueCmsPublishOutboxes(result.tasks, `站点 #${siteId} 继承策略更新`);
  return {
    inheritance: result.inheritance,
    effectiveConfig: await getCmsEffectiveConfig(siteId),
    affectedSiteIds: result.affectedSiteIds,
  };
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsSite(id: number) {
  await assertSiteAccess(id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
    const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, id)).for('update').limit(1);
    if (!site) throw new HTTPException(404, { message: '站点不存在' });
    const [childCount, channelCount, distributionCount] = await Promise.all([
      tx.$count(cmsSites, eq(cmsSites.parentId, id)),
      tx.$count(cmsChannels, eq(cmsChannels.siteId, id)),
      tx.$count(cmsDistributionRules, or(
        eq(cmsDistributionRules.sourceSiteId, id),
        eq(cmsDistributionRules.targetSiteId, id),
      )),
    ]);
    if (childCount > 0) throw new HTTPException(400, { message: `该站点下存在 ${childCount} 个子站点，请先移动或删除子站点` });
    if (distributionCount > 0) throw new HTTPException(400, { message: `该站点被 ${distributionCount} 条分发规则引用，请先删除规则` });
    if (channelCount > 0) throw new HTTPException(400, { message: `该站点下存在 ${channelCount} 个栏目，请先删除栏目` });
    const [row] = await tx.delete(cmsSites).where(eq(cmsSites.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '站点不存在' });
  });
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
  await db.transaction(async (tx) => {
    const locked = await lockCmsSiteForMutation(tx, siteId);
    await tx.update(cmsSites)
      .set({ settings: { ...(locked.settings ?? {}), analyticsSiteKey: analyticsSite.siteKey } })
      .where(eq(cmsSites.id, siteId));
  });
  invalidateSiteCache();
  return { siteKey: analyticsSite.siteKey, created: true };
}
