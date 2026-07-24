import dayjs from 'dayjs';
import { and, desc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTask } from '@zenith/shared';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import {
  cmsSites,
  cmsThemeDeployments,
  cmsThemePackages,
  type CmsSiteRow,
  type CmsThemeDeploymentRow,
  type CmsThemePackageRow,
} from '../../db/schema';
import { enqueueAsyncTask } from '../../lib/task-center';
import logger from '../../lib/logger';
import { isThemeRegistered } from '../../cms/themes/registry';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { getSiteTemplateHealth } from './cms-template-refs.service';
import { assertSitesAccess, invalidateSiteCache } from './cms-sites.service';
import { getCmsThemePackage } from './cms-themes.service';
import { submitCmsPublishTask } from './cms-publishing.service';
import { packageTemplateOptions, resolveAvailableCmsTemplateNames } from './cms-template-resolution.service';
import { cmsThemeLifecycleEventKey, isCurrentCmsThemeDeployment } from './cms-lifecycle-policy';
import { acquireCmsGlobalThemeLifecycleLock, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import {
  listCmsInheritanceAffectedSiteIds,
  resolveEffectiveCmsSite,
} from './cms-site-inheritance.service';

async function enqueueLifecycleTask(task: AsyncTask): Promise<void> {
  await enqueueAsyncTask(task.id).catch((error) => {
    logger.error(`[cms-theme-lifecycle] 主题生命周期任务 #${task.id} 入队失败，等待 pending 恢复扫描补投`, error);
  });
}

async function lockSite(tx: DbTransaction, siteId: number): Promise<CmsSiteRow> {
  return lockCmsSiteForMutation(tx, siteId);
}

async function lockPackage(tx: DbTransaction, packageId: number): Promise<CmsThemePackageRow> {
  const [pkg] = await tx.select().from(cmsThemePackages).where(eq(cmsThemePackages.id, packageId)).for('update').limit(1);
  if (!pkg) throw new HTTPException(404, { message: '主题包版本不存在' });
  return pkg;
}

async function lockActiveDeployment(tx: DbTransaction, siteId: number): Promise<CmsThemeDeploymentRow | null> {
  const [deployment] = await tx.select().from(cmsThemeDeployments).where(and(
    eq(cmsThemeDeployments.siteId, siteId),
    eq(cmsThemeDeployments.status, 'active'),
  )).for('update').limit(1);
  return deployment ?? null;
}

async function deactivateDeployment(tx: DbTransaction, deployment: CmsThemeDeploymentRow | null): Promise<void> {
  if (!deployment) return;
  await tx.update(cmsThemeDeployments).set({
    status: 'inactive',
    deactivatedAt: dayjs().toDate(),
  }).where(and(
    eq(cmsThemeDeployments.id, deployment.id),
    eq(cmsThemeDeployments.status, 'active'),
  ));
}

async function insertThemeTask(
  tx: DbTransaction,
  site: CmsSiteRow,
  input: { themeCode: string; packageId?: number; deploymentId: number | null; reason: string },
): Promise<AsyncTask> {
  return submitCmsPublishTask({
    siteId: site.id,
    targetType: 'theme',
    themeCode: input.themeCode,
    themePackageId: input.packageId,
    expectedThemeRevision: site.themeRevision,
    expectedTemplateRefsRevision: site.templateRefsRevision,
    expectedDeploymentId: input.deploymentId,
    reason: input.reason,
  }, {
    skipPermissionCheck: true,
    skipAccessCheck: true,
    executor: tx,
    eventKey: cmsThemeLifecycleEventKey(site.id, site.themeRevision),
  });
}

async function assertThemeLifecycleScope(siteId: number): Promise<number[]> {
  const snapshot = await resolveEffectiveCmsSite(siteId);
  if (snapshot.sourceSiteIds.theme !== siteId) {
    throw new HTTPException(409, { message: '该站点当前继承父级主题，请先在站点继承设置中切换为“本站覆盖”' });
  }
  const affectedSiteIds = await listCmsInheritanceAffectedSiteIds(siteId, 'theme');
  await assertSitesAccess(affectedSiteIds);
  for (const affectedId of affectedSiteIds) await assertAllCmsSiteChannelsAccess(affectedId);
  return affectedSiteIds;
}

async function insertAffectedThemeTasks(
  tx: DbTransaction,
  rootSite: CmsSiteRow,
  affectedSiteIds: readonly number[],
  input: { themeCode: string; packageId?: number; deploymentId: number | null; reason: string },
): Promise<AsyncTask[]> {
  const tasks: AsyncTask[] = [];
  for (const siteId of [...affectedSiteIds].sort((a, b) => a - b)) {
    let site = rootSite;
    if (siteId !== rootSite.id) {
      await lockCmsSiteForMutation(tx, siteId);
      [site] = await tx.update(cmsSites).set({
        themeRevision: sql`${cmsSites.themeRevision} + 1`,
      }).where(eq(cmsSites.id, siteId)).returning();
    }
    tasks.push(await insertThemeTask(tx, site, input));
  }
  return tasks;
}

async function currentAffectedThemeSiteIds(tx: DbTransaction, siteId: number): Promise<number[]> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
  const snapshot = await resolveEffectiveCmsSite(siteId, tx);
  if (snapshot.sourceSiteIds.theme !== siteId) {
    throw new HTTPException(409, { message: '该站点已切换为继承父级主题，请刷新后重试' });
  }
  const affectedSiteIds = await listCmsInheritanceAffectedSiteIds(siteId, 'theme', tx);
  await assertSitesAccess(affectedSiteIds);
  for (const affectedId of affectedSiteIds) await assertAllCmsSiteChannelsAccess(affectedId);
  return affectedSiteIds;
}

function assertPackageUsable(pkg: CmsThemePackageRow): void {
  if (pkg.status !== 'validated' || !pkg.validationReport.valid) {
    throw new HTTPException(400, { message: '主题包未通过可信校验或已停用，不能激活' });
  }
  const required = ['index', 'list', 'detail', 'page', 'search', 'tag', 'not_found'];
  const missing = required.filter((type) => !pkg.manifest.templates.some((item) => item.type === type));
  if (missing.length) throw new HTTPException(400, { message: `主题包缺少正式渲染模板：${missing.join('、')}` });
}

async function assertPackageCompatible(siteId: number, pkg: CmsThemePackageRow): Promise<void> {
  const health = await getSiteTemplateHealth(siteId, pkg.code, {
    list: packageTemplateOptions(pkg, 'list').map((item) => item.name),
    detail: packageTemplateOptions(pkg, 'detail').map((item) => item.name),
    themeAvailable: true,
  });
  if (health.invalidRefs.length > 0) {
    throw new HTTPException(400, {
      message: `主题包与站点现有模板引用不兼容（${health.invalidRefs.length} 处），请先查看影响分析并清理失效引用`,
    });
  }
}

async function assertBuiltinCompatible(siteId: number, themeCode: string): Promise<void> {
  const available = await resolveAvailableCmsTemplateNames(siteId, themeCode, { ignoreActivePackage: true });
  const health = await getSiteTemplateHealth(siteId, themeCode, {
    list: [...available.list],
    detail: [...available.detail],
    themeAvailable: available.themeAvailable,
  });
  if (health.invalidRefs.length > 0) {
    throw new HTTPException(400, { message: `内置主题与站点现有模板引用不兼容（${health.invalidRefs.length} 处），请先清理失效引用` });
  }
}

export async function activateCmsThemePackage(packageId: number, siteId: number) {
  const initialAffectedSiteIds = await assertThemeLifecycleScope(siteId);
  const initial = await db.query.cmsThemePackages.findFirst({ where: eq(cmsThemePackages.id, packageId) });
  if (!initial) throw new HTTPException(404, { message: '主题包版本不存在' });
  assertPackageUsable(initial);
  for (const affectedId of initialAffectedSiteIds) await assertPackageCompatible(affectedId, initial);

  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const affectedSiteIds = await currentAffectedThemeSiteIds(tx, siteId);
    await assertSitesAccess(affectedSiteIds);
    const site = await lockSite(tx, siteId);
    const pkg = await lockPackage(tx, packageId);
    assertPackageUsable(pkg);
    for (const affectedId of affectedSiteIds) await assertPackageCompatible(affectedId, pkg);
    const active = await lockActiveDeployment(tx, siteId);
    if (site.theme === pkg.code && active?.themePackageId === pkg.id) {
      throw new HTTPException(409, { message: `主题 ${pkg.code}@${pkg.version} 已是当前活动版本` });
    }
    await deactivateDeployment(tx, active);
    const [existing] = await tx.select().from(cmsThemeDeployments).where(and(
      eq(cmsThemeDeployments.siteId, siteId),
      eq(cmsThemeDeployments.themePackageId, packageId),
    )).for('update').limit(1);
    let deploymentId: number;
    if (existing) {
      const [deployment] = await tx.update(cmsThemeDeployments).set({
        themeCode: pkg.code,
        status: 'active',
        activatedAt: dayjs().toDate(),
        deactivatedAt: null,
      }).where(eq(cmsThemeDeployments.id, existing.id)).returning({ id: cmsThemeDeployments.id });
      deploymentId = deployment.id;
    } else {
      const [deployment] = await tx.insert(cmsThemeDeployments).values({
        siteId,
        themeCode: pkg.code,
        themePackageId: pkg.id,
        status: 'active',
      }).returning({ id: cmsThemeDeployments.id });
      deploymentId = deployment.id;
    }
    const [updatedSite] = await tx.update(cmsSites).set({
      theme: pkg.code,
      themeRevision: sql`${cmsSites.themeRevision} + 1`,
    }).where(eq(cmsSites.id, siteId)).returning();
    const tasks = await insertAffectedThemeTasks(tx, updatedSite, affectedSiteIds, {
      themeCode: pkg.code,
      packageId: pkg.id,
      deploymentId,
      reason: `激活主题 ${pkg.code}@${pkg.version}`,
    });
    return { pkg, site: updatedSite, tasks };
  });
  invalidateSiteCache();
  for (const task of result.tasks) await enqueueLifecycleTask(task);
  return {
    package: await getCmsThemePackage(result.pkg.id),
    siteName: result.site.name,
    task: result.tasks[0],
    tasks: result.tasks,
  };
}

export async function activateBuiltinCmsTheme(siteId: number, themeCode: string) {
  if (!isThemeRegistered(themeCode)) throw new HTTPException(400, { message: `内置主题「${themeCode}」不存在` });
  const initialAffectedSiteIds = await assertThemeLifecycleScope(siteId);
  for (const affectedId of initialAffectedSiteIds) await assertBuiltinCompatible(affectedId, themeCode);
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const affectedSiteIds = await currentAffectedThemeSiteIds(tx, siteId);
    await assertSitesAccess(affectedSiteIds);
    const site = await lockSite(tx, siteId);
    for (const affectedId of affectedSiteIds) await assertBuiltinCompatible(affectedId, themeCode);
    const active = await lockActiveDeployment(tx, siteId);
    if (site.theme === themeCode && !active) throw new HTTPException(409, { message: `内置主题 ${themeCode} 已激活` });
    await deactivateDeployment(tx, active);
    const [updatedSite] = await tx.update(cmsSites).set({
      theme: themeCode,
      themeRevision: sql`${cmsSites.themeRevision} + 1`,
    }).where(eq(cmsSites.id, siteId)).returning();
    const tasks = await insertAffectedThemeTasks(tx, updatedSite, affectedSiteIds, {
      themeCode,
      deploymentId: null,
      reason: `激活内置主题 ${themeCode}`,
    });
    return { site: updatedSite, tasks };
  });
  invalidateSiteCache();
  for (const task of result.tasks) await enqueueLifecycleTask(task);
  return { themeCode, siteName: result.site.name, task: result.tasks[0], tasks: result.tasks };
}

export async function deactivateCmsThemeForSite(siteId: number, themeCode: string, packageId: number) {
  await assertThemeLifecycleScope(siteId);
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const affectedSiteIds = await currentAffectedThemeSiteIds(tx, siteId);
    await assertSitesAccess(affectedSiteIds);
    const site = await lockSite(tx, siteId);
    const pkg = await lockPackage(tx, packageId);
    for (const affectedId of affectedSiteIds) await assertBuiltinCompatible(affectedId, 'default');
    const active = await lockActiveDeployment(tx, siteId);
    if (!isCurrentCmsThemeDeployment({
      siteTheme: site.theme,
      requestedThemeCode: themeCode,
      requestedPackageId: packageId,
      packageCode: pkg.code,
      activeDeployment: active,
    })) {
      throw new HTTPException(409, { message: '请求的主题部署不是该站点当前活动部署，未执行任何变更' });
    }
    await deactivateDeployment(tx, active);
    const [updatedSite] = await tx.update(cmsSites).set({
      theme: 'default',
      themeRevision: sql`${cmsSites.themeRevision} + 1`,
    }).where(eq(cmsSites.id, siteId)).returning();
    const tasks = await insertAffectedThemeTasks(tx, updatedSite, affectedSiteIds, {
      themeCode: 'default',
      deploymentId: null,
      reason: `停用主题 ${themeCode}@${pkg.version}，回退内置 default`,
    });
    return { site: updatedSite, tasks };
  });
  invalidateSiteCache();
  for (const task of result.tasks) await enqueueLifecycleTask(task);
  return { task: result.tasks[0], tasks: result.tasks };
}

export async function rollbackCmsThemePackage(siteId: number, themeCode: string, currentPackageId: number) {
  await assertThemeLifecycleScope(siteId);
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const affectedSiteIds = await currentAffectedThemeSiteIds(tx, siteId);
    await assertSitesAccess(affectedSiteIds);
    const site = await lockSite(tx, siteId);
    const currentPackage = await lockPackage(tx, currentPackageId);
    const active = await lockActiveDeployment(tx, siteId);
    if (!active || active.themePackageId !== currentPackageId || active.themeCode !== themeCode || site.theme !== themeCode) {
      throw new HTTPException(409, { message: '请求的主题部署不是当前活动部署，无法回滚' });
    }
    const [previous] = await tx.select().from(cmsThemeDeployments).where(and(
      eq(cmsThemeDeployments.siteId, siteId),
      eq(cmsThemeDeployments.themeCode, themeCode),
      eq(cmsThemeDeployments.status, 'inactive'),
    )).orderBy(desc(cmsThemeDeployments.activatedAt)).limit(1);
    if (!previous) throw new HTTPException(400, { message: '没有可回滚的上一主题包版本' });
    const previousPackage = previous.themePackageId === currentPackageId
      ? currentPackage
      : await lockPackage(tx, previous.themePackageId);
    assertPackageUsable(previousPackage);
    for (const affectedId of affectedSiteIds) await assertPackageCompatible(affectedId, previousPackage);
    const [lockedPrevious] = await tx.select().from(cmsThemeDeployments)
      .where(and(eq(cmsThemeDeployments.id, previous.id), eq(cmsThemeDeployments.status, 'inactive')))
      .for('update').limit(1);
    if (!lockedPrevious) throw new HTTPException(409, { message: '可回滚主题版本已发生变化，请刷新后重试' });
    await deactivateDeployment(tx, active);
    await tx.update(cmsThemeDeployments).set({
      status: 'active',
      activatedAt: dayjs().toDate(),
      deactivatedAt: null,
    }).where(eq(cmsThemeDeployments.id, lockedPrevious.id));
    const [updatedSite] = await tx.update(cmsSites).set({
      theme: previousPackage.code,
      themeRevision: sql`${cmsSites.themeRevision} + 1`,
    }).where(eq(cmsSites.id, siteId)).returning();
    const tasks = await insertAffectedThemeTasks(tx, updatedSite, affectedSiteIds, {
      themeCode: previousPackage.code,
      packageId: previousPackage.id,
      deploymentId: lockedPrevious.id,
      reason: `主题回滚至 ${previousPackage.code}@${previousPackage.version}`,
    });
    return { pkg: previousPackage, site: updatedSite, tasks };
  });
  invalidateSiteCache();
  for (const task of result.tasks) await enqueueLifecycleTask(task);
  return {
    package: await getCmsThemePackage(result.pkg.id),
    siteName: result.site.name,
    task: result.tasks[0],
    tasks: result.tasks,
  };
}

export async function setCmsThemePackageStatus(id: number, status: 'validated' | 'disabled') {
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    if (status === 'disabled') {
      const activeSites = await tx.select({ siteId: cmsThemeDeployments.siteId }).from(cmsThemeDeployments).where(and(
        eq(cmsThemeDeployments.themePackageId, id),
        eq(cmsThemeDeployments.status, 'active'),
      ));
      for (const siteId of [...new Set(activeSites.map((item) => item.siteId))].sort((a, b) => a - b)) {
        await lockSite(tx, siteId);
      }
    }
    const pkg = await lockPackage(tx, id);
    if (status === pkg.status) throw new HTTPException(409, { message: `主题包已经是 ${status} 状态` });
    if (status === 'validated' && !pkg.validationReport.valid) {
      throw new HTTPException(400, { message: '该主题包没有可信的成功校验报告，必须重新签名并导入，不能直接恢复' });
    }
    if (status === 'disabled') {
      const active = await tx.select({ id: cmsThemeDeployments.id }).from(cmsThemeDeployments).where(and(
        eq(cmsThemeDeployments.themePackageId, id),
        eq(cmsThemeDeployments.status, 'active'),
      )).for('update');
      if (active.length > 0) throw new HTTPException(409, { message: `主题包仍在 ${active.length} 个站点生效，请先停用站点部署` });
    }
    const [updated] = await tx.update(cmsThemePackages).set({ status }).where(eq(cmsThemePackages.id, id)).returning();
    return updated;
  });
  return getCmsThemePackage(result.id);
}
