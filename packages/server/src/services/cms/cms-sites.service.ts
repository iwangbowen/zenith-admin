import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { clearDefaultFlag } from '../../lib/default-flag';
import { eq, asc, and, or, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  cmsSites,
  cmsChannels,
  cmsDistributionRules,
  cmsModels,
  cmsSiteInheritances,
  cmsSiteUsers,
  users,
} from '../../db/schema';
import type { CmsSiteInheritanceRow, CmsSiteRow } from '../../db/schema';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import logger from '../../lib/logger';
import { currentCmsOpenApiAccess, currentUser, hasPermission } from '../../lib/context';
import { CMS_SITE_INHERITABLE_FIELDS, CMS_SITE_MAX_DEPTH, cmsSiteContract } from '@zenith/shared/cms';
import type { CmsSiteInheritableField, CmsSiteInheritanceFlags, CreateCmsSiteInput, UpdateCmsSiteInput } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { assertSiteTemplateSettings, assertSiteThemeConfig, pruneStaleTemplateDefaults } from './cms-template-refs.service';
import { isCmsPlatformAdmin } from './cms-access';
import {
  mergeCmsSiteSettings, normalizeNewCmsSiteSettings, redactCmsSiteSettings,
} from './cms-site-settings';
import { cmsCdnPurgeHostAllowlist, validateCdnPurgeEndpoint } from './cms-cdn-policy';
import { isThemeRegistered } from '../../cms/themes/registry';
import { acquireCmsSitePublishLock, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import { canonicalizeCmsResourceFields, resolveCmsResourcePayload, syncCmsResourceRefs } from './cms-resource-refs.service';
import { syncCmsSiteWebhookSubscription } from './cms-webhook.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';
import {
  DEFAULT_CMS_SITE_INHERITANCE,
  buildCmsSiteChain,
  getCmsSiteEffectiveConfig,
  listCmsSubtreeIds,
  loadCmsInheritanceState,
  resolveCmsSiteSnapshot,
} from './cms-site-inheritance.service';
import { planCmsSiteMove, validateCmsSiteEnablement } from './cms-site-hierarchy-policy';
import { buildTree } from '@zenith/shared/core';

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
let siteCache: { byHost: Map<string, CmsSiteRow>; byCode: Map<string, CmsSiteRow>; defaultSite: CmsSiteRow | null; loadedAt: number } | null = null;
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
  const byCode = new Map<string, CmsSiteRow>();
  let defaultSite: CmsSiteRow | null = null;
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, row);
    if (row.domain && !byHost.has(row.domain.toLowerCase())) byHost.set(row.domain.toLowerCase(), row);
    for (const alias of row.aliasDomains ?? []) {
      if (alias && !byHost.has(alias.toLowerCase())) byHost.set(alias.toLowerCase(), row);
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
// 策略：非平台超管必须在 cms_site_users 中显式绑定；平台超管可绕过。

/** 当前用户可管理的站点 id 集合；null = 不受限 */
export async function getAccessibleSiteIds(): Promise<number[] | null> {
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) return [openAccess.siteId];
  const user = currentUser();
  if (isCmsPlatformAdmin(user)) return null;
  const rows = await db.select({ siteId: cmsSiteUsers.siteId }).from(cmsSiteUsers)
    .where(eq(cmsSiteUsers.userId, user.userId));
  return rows.map((r) => r.siteId);
}

/** 站点访问断言：非平台超管没有显式站点绑定时拒绝。 */
export async function assertSiteAccess(siteId: number): Promise<void> {
  await ensureCmsSiteExists(siteId);
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) {
    if (openAccess.siteId !== siteId) {
      throw new HTTPException(403, { message: '开放应用未授权该站点' });
    }
    return;
  }
  const ids = await getAccessibleSiteIds();
  if (ids !== null && !ids.includes(siteId)) {
    throw new HTTPException(403, { message: '无权管理该站点' });
  }
}

/** 完整批量 ACL：任一目标不可见即整体拒绝，禁止站群操作静默裁剪。 */
export async function assertSitesAccess(
  siteIds: readonly number[],
  deniedMessage = '站群操作要求对全部目标站点具有显式权限',
): Promise<void> {
  const unique = [...new Set(siteIds)];
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) {
    if (unique.some((id) => id !== openAccess.siteId)) {
      throw new HTTPException(403, { message: deniedMessage });
    }
    return;
  }
  const accessible = await getAccessibleSiteIds();
  if (accessible === null) return;
  const allowed = new Set(accessible);
  if (unique.some((id) => !allowed.has(id))) {
    throw new HTTPException(403, { message: deniedMessage });
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
  modelName?: string | null;
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
    publicRevision: row.publicRevision,
    staticMode: row.staticMode,
    effectiveStaticMode: meta.effectiveStaticMode,
    robots: row.robots ?? null,
    modelId: row.modelId ?? null,
    modelName: meta.modelName,
    extend: row.extend ?? {},
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
  return requireRow(row, '站点不存在');
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
  const site = requireRow(mapped, '站点不存在');
  if (!site.modelId) return resolveCmsResourcePayload(site, site.id);
  const [model] = await db.select({ name: cmsModels.name }).from(cmsModels)
    .where(eq(cmsModels.id, site.modelId)).limit(1);
  return resolveCmsResourcePayload({ ...site, modelName: model?.name ?? null }, site.id);
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export async function listCmsSites(q: QueryOutputOf<typeof cmsSiteContract.list>) {
  const { keyword = '', status, page, pageSize } = q;
  const conditions: (SQL | undefined)[] = [];
  const accessible = await getAccessibleSiteIds();
  if (accessible !== null) conditions.push(inArray(cmsSites.id, accessible));
  conditions.push(keywordCondition(keyword, [cmsSites.name, cmsSites.code, cmsSites.domain]));
  if (status) conditions.push(eq(cmsSites.status, status));

  const where = buildWhere(...conditions);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(cmsSites, where),
    rows: async () => {
      const list = await withPagination(
        db.select().from(cmsSites).where(where).orderBy(asc(cmsSites.sort), asc(cmsSites.id)).$dynamic(),
        page,
        pageSize,
      );
      const [allRows, inheritanceRows] = await Promise.all([
        db.select().from(cmsSites),
        db.select().from(cmsSiteInheritances),
      ]);
      const mapped = mapCmsSiteRows(list, allRows, inheritanceRows, accessible);
      return Promise.all(mapped.map((row) => resolveCmsResourcePayload(row, row.id)));
    },
  });
}

/** 全部启用站点（下拉选择/站点切换器用，绑定用户仅见授权站点） */
export async function listAllCmsSites() {
  const accessible = await getAccessibleSiteIds();
  const conditions: (SQL | undefined)[] = [eq(cmsSites.status, 'enabled')];
  if (accessible !== null) conditions.push(inArray(cmsSites.id, accessible));
  const where = buildWhere(...conditions);
  const rows = await db.select().from(cmsSites)
    .where(where)
    .orderBy(asc(cmsSites.sort), asc(cmsSites.id));
  const [allRows, inheritanceRows] = await Promise.all([
    db.select().from(cmsSites),
    db.select().from(cmsSiteInheritances),
  ]);
  const mapped = mapCmsSiteRows(rows, allRows, inheritanceRows, accessible);
  return Promise.all(mapped.map((row) => resolveCmsResourcePayload(row, row.id)));
}

type CmsSiteTreeNode = ReturnType<typeof mapCmsSite> & { children?: CmsSiteTreeNode[] };

export async function listCmsSiteTree(query: { keyword?: string; status?: 'enabled' | 'disabled' }): Promise<CmsSiteTreeNode[]> {
  const accessible = await getAccessibleSiteIds();
  const conditions: (SQL | undefined)[] = [];
  if (accessible !== null) conditions.push(inArray(cmsSites.id, accessible));
  conditions.push(keywordCondition(query.keyword, [cmsSites.name, cmsSites.code, cmsSites.domain]));
  if (query.status) conditions.push(eq(cmsSites.status, query.status));
  const [rows, allRows, inheritanceRows] = await Promise.all([
    db.select().from(cmsSites).where(buildWhere(...conditions))
      .orderBy(asc(cmsSites.sort), asc(cmsSites.id)),
    db.select().from(cmsSites),
    db.select().from(cmsSiteInheritances),
  ]);
  return buildTree<CmsSiteTreeNode>(mapCmsSiteRows(rows, allRows, inheritanceRows, accessible));
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
  if (data.theme !== undefined) fields.add('theme');
  if (data.settings !== undefined) {
    fields.add('reviewMode');
    fields.add('webhook');
    fields.add('cdn');
    fields.add('themeConfig');
    fields.add('templates');
  }
  return [...fields];
}

/** Fields whose values are embedded in public HTML, metadata or route lookup. */
const CMS_PUBLIC_SITE_UPDATE_FIELDS = new Set([
  'name', 'code', 'domain', 'aliasDomains', 'isDefault',
  'title', 'keywords', 'description', 'logo', 'favicon', 'icp', 'copyright',
  'staticMode', 'theme', 'robots', 'modelId', 'extend', 'settings', 'status',
]);

function changesCmsPublicSiteConfiguration(data: UpdateCmsSiteInput): boolean {
  return Object.keys(data).some((key) => CMS_PUBLIC_SITE_UPDATE_FIELDS.has(key));
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
    await acquireCmsSitePublishLock(tx, siteId);
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
  await ensureSiteModelValid(siteData.modelId);
  if (!isThemeRegistered(siteData.theme ?? 'default')) {
    throw new HTTPException(400, { message: `主题「${siteData.theme ?? 'default'}」不存在，仅支持内置主题` });
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
      if (siteData.isDefault) await clearDefaultFlag(tx, cmsSites, eq(cmsSites.isDefault, true));
      const [created] = await tx.insert(cmsSites).values({
        ...siteData,
        parentId,
        settings,
        domain: siteData.domain?.trim() ? siteData.domain.trim().toLowerCase() : null,
        aliasDomains: (siteData.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean),
      }).returning();
      await syncCmsResourceRefs(tx, 'site', created.id, created.id, created);
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

/** 校验站点扩展模型有效性（与栏目 ensureModelValid 同口径） */
async function ensureSiteModelValid(modelId: number | null | undefined) {
  if (!modelId) return;
  const [row] = await db.select({ id: cmsModels.id }).from(cmsModels)
    .where(eq(cmsModels.id, modelId)).limit(1);
  requireRow(row, `指定的内容模型（id=${modelId}）不存在`, 400);
}

/**
 * 保存前自愈：摘掉本次未改动、但在当前主题下已失效的默认模板引用。
 * 主题移除模板变体后留下的死配置，否则会卡住该站点全部 settings 写入。
 */
function pruneStaleCmsTemplateDefaults(
  site: Pick<CmsSiteRow, 'id' | 'theme' | 'settings'>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const { settings, removed } = pruneStaleTemplateDefaults(site.theme, merged, site.settings);
  if (removed.length > 0) {
    logger.warn(`[CMS] 站点 #${site.id} 已自动清除失效默认模板配置：${removed.join('、')}`);
  }
  return settings;
}

export async function updateCmsSite(id: number, data: UpdateCmsSiteInput) {
  await assertSiteAccess(id);
 const current = await ensureCmsSiteExists(id);
  const previousCode = current.code;
  await ensureSiteModelValid(data.modelId);
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
  const publicConfigChanged = changesCmsPublicSiteConfiguration(data);
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
    : pruneStaleCmsTemplateDefaults(current, mergeCmsSiteSettings(current.settings, data.settings as Record<string, unknown>));
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
        : pruneStaleCmsTemplateDefaults(locked, mergeCmsSiteSettings(locked.settings, data.settings as Record<string, unknown>));
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
      if (data.isDefault) await clearDefaultFlag(tx, cmsSites, eq(cmsSites.isDefault, true));
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
      if (data.modelId !== undefined) patch.modelId = data.modelId;
      // extend 与 modelId 解耦写入：解绑模型时同步清空扩展值，避免残留异构字段
      if (data.extend !== undefined) patch.extend = data.extend;
      else if (data.modelId === null) patch.extend = {};
      // 主题切换：仅内置主题；变更时 bump themeRevision 供发布 fence 判定
      if (data.theme !== undefined && data.theme !== locked.theme) {
        if (!isThemeRegistered(data.theme)) {
          throw new HTTPException(400, { message: `主题「${data.theme}」不存在` });
        }
        patch.theme = data.theme;
        patch.themeRevision = sql`${cmsSites.themeRevision} + 1`;
      }
      if (data.settings !== undefined) {
        patch.settings = lockedSettings;
      }
      if (data.domain !== undefined) patch.domain = data.domain?.trim() ? data.domain.trim().toLowerCase() : null;
      if (data.aliasDomains !== undefined) patch.aliasDomains = (data.aliasDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
      const [updated] = await tx.update(cmsSites)
        .set(await canonicalizeCmsResourceFields(tx, id, patch, 'site'))
        .where(and(
          eq(cmsSites.id, id),
        )).returning();
      requireRow(updated, '站点不存在');
      await syncCmsResourceRefs(tx, 'site', updated.id, updated.id, updated);
      const tasks = await insertEffectiveConfigRebuildTasks(
        tx,
        id,
        changedFields,
        '站点有效配置更新',
      );
      // Inheritance changes already create one task per affected site. For
      // branding, host, robots, status and other site-local public fields,
      // enqueue a full site rebuild as part of the same transaction. This is
      // also required when the site is disabled (its old files must be
      // removed before a later re-enable).
      const taskSiteIds = new Set(tasks.map((task) => {
        const value = task.payload?.siteId;
        return typeof value === 'number' ? value : null;
      }).filter((value): value is number => value != null));
      if (publicConfigChanged && !taskSiteIds.has(id)) {
        tasks.push(await insertCmsSiteRefsRebuildOutbox(
          tx,
          updated,
          '站点公开配置更新',
          `site:${id}:public-config:${updated.updatedAt.getTime()}`,
        ));
      }
      if (updated.code !== previousCode) {
        const { clearSiteStatic } = await import('./cms-static.service');
        await clearSiteStatic(previousCode);
      }
      return { updated, tasks };
    });
   invalidateSiteCache();
    await invalidateCmsSiteCaches(id);
   if (row.tasks.length) await enqueueCmsPublishOutboxes(row.tasks, `站点 #${id} 配置更新`);
    // Webhook 配置托管为一条 internal 订阅，站点级回调因此也有重试与投递日志
    await syncCmsSiteWebhookSubscription(id).catch((error) => {
      logger.warn(`[cms-webhook] 站点 #${id} Webhook 订阅同步失败`, error);
    });
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
    const currentSite = requireRow(current, '站点不存在');
    if (currentSite.parentId === parentId) throw new HTTPException(409, { message: '站点已经位于所选父级下' });
    let plan;
    try {
      plan = planCmsSiteMove(rows, id, parentId);
      if (currentSite.status === 'enabled' && parentId != null) {
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
      await acquireCmsSitePublishLock(tx, siteId);
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
  const currentSite = requireRow(site, '站点不存在');
  if (currentSite.parentId == null && Object.values(patch).some(Boolean)) {
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
      await acquireCmsSitePublishLock(tx, affectedId);
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
    await acquireCmsSitePublishLock(tx, id);
   const [site] = await tx.select().from(cmsSites).where(eq(cmsSites.id, id)).for('update').limit(1);
    requireRow(site, '站点不存在');
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
   requireRow(row, '站点不存在');
    const { clearSiteStatic } = await import('./cms-static.service');
    await clearSiteStatic(row.code);
 });
 invalidateSiteCache();
  await invalidateCmsSiteCaches(id);
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
  const result = await db.transaction(async (tx) => {
    const locked = await lockCmsSiteForMutation(tx, siteId);
    const [updated] = await tx.update(cmsSites)
      .set({ settings: { ...(locked.settings ?? {}), analyticsSiteKey: analyticsSite.siteKey } })
      .where(eq(cmsSites.id, siteId)).returning();
    requireRow(updated, '站点不存在');
    const task = await insertCmsSiteRefsRebuildOutbox(
      tx,
      updated,
      '站点统计配置更新',
      `site:${siteId}:analytics:${analyticsSite.siteKey}`,
    );
    return { task };
  });
  invalidateSiteCache();
  await invalidateCmsSiteCaches(siteId);
  await enqueueCmsPublishOutboxes([result.task], `站点 #${siteId} 统计配置更新`);
  return { siteKey: analyticsSite.siteKey, created: true };
}
