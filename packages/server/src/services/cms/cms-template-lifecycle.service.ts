import { and, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTask } from '@zenith/shared';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { cmsTemplates, cmsTemplateVersions, type CmsSiteRow, type CmsTemplateRow } from '../../db/schema';
import { enqueueAsyncTask } from '../../lib/task-center';
import logger from '../../lib/logger';
import { assertSiteAccess, assertSitesAccess } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { isCmsPlatformAdmin } from './cms-access';
import { mapCmsTemplate } from './cms-templates.service';
import { submitCmsPublishTask } from './cms-publishing.service';
import { cmsTemplateLifecycleEventKey, isManualTemplateLifecycleAllowed } from './cms-lifecycle-policy';
import {
  acquireCmsGlobalThemeLifecycleLock,
  bumpCmsTemplateRefsRevision,
  cmsSiteFencePayload,
  lockCmsSiteForMutation,
} from './cms-site-publish-lock.service';
import { findCmsTemplateReferences } from './cms-template-refs.service';
import { listCmsTemplateAffectedSiteIds } from './cms-site-inheritance.service';

async function assertLifecycleScope(row: CmsTemplateRow): Promise<void> {
  if (row.siteId != null) {
    await assertSiteAccess(row.siteId);
  } else if (!isCmsPlatformAdmin()) {
    throw new HTTPException(403, { message: '仅平台超级管理员可变更主题级全局模板生命周期' });
  }
  const affectedSiteIds = await listCmsTemplateAffectedSiteIds(row.siteId, row.themeCode, db, {
    type: row.type,
    code: row.code,
  });
  await assertSitesAccess(affectedSiteIds);
  for (const siteId of affectedSiteIds) await assertAllCmsSiteChannelsAccess(siteId);
}

async function lockAffectedSites(tx: DbTransaction, row: CmsTemplateRow): Promise<CmsSiteRow[]> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cms-site-hierarchy'))`);
  const ids = await listCmsTemplateAffectedSiteIds(row.siteId, row.themeCode, tx, {
    type: row.type,
    code: row.code,
  });
  await assertSitesAccess(ids);
  for (const siteId of ids) await assertAllCmsSiteChannelsAccess(siteId);
  const sites: CmsSiteRow[] = [];
  for (const siteId of [...new Set(ids)].sort((a, b) => a - b)) {
    sites.push(await lockCmsSiteForMutation(tx, siteId));
  }
  return sites;
}

async function enqueueLifecycleTasks(tasks: AsyncTask[]): Promise<void> {
  for (const task of tasks) {
    await enqueueAsyncTask(task.id).catch((error) => {
      logger.error(`[cms-template-lifecycle] 模板生命周期任务 #${task.id} 入队失败，等待 pending 恢复扫描补投`, error);
    });
  }
}

async function insertLifecycleTasks(
  tx: DbTransaction,
  row: CmsTemplateRow,
  revision: number,
  sites: CmsSiteRow[],
  reason: string,
): Promise<AsyncTask[]> {
  const tasks: AsyncTask[] = [];
  for (const site of sites) {
    const fencedSite = {
      ...site,
      templateRefsRevision: await bumpCmsTemplateRefsRevision(tx, site.id),
    };
    tasks.push(await submitCmsPublishTask({
      siteId: fencedSite.id,
      targetType: 'template',
      templateId: row.id,
      themeCode: row.themeCode,
      ...await cmsSiteFencePayload(tx, fencedSite),
      expectedTemplateLifecycleRevision: revision,
      reason,
    }, {
      skipPermissionCheck: true,
      skipAccessCheck: true,
      executor: tx,
      eventKey: cmsTemplateLifecycleEventKey(row.id, revision, fencedSite.id),
    }));
  }
  return tasks;
}

export async function activateCmsTemplate(id: number, version?: number) {
  const current = await db.query.cmsTemplates.findFirst({ where: eq(cmsTemplates.id, id) });
  if (!current) throw new HTTPException(404, { message: '模板不存在' });
  await assertLifecycleScope(current);
  if (!isManualTemplateLifecycleAllowed(current.source)) throw new HTTPException(400, { message: '主题包模板状态由站点活动 package deployment 派生，禁止手工激活' });
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const [locked] = await tx.select().from(cmsTemplates).where(eq(cmsTemplates.id, id)).for('update').limit(1);
    if (!locked) throw new HTTPException(404, { message: '模板不存在' });
    if (!isManualTemplateLifecycleAllowed(locked.source)) throw new HTTPException(400, { message: '主题包模板禁止手工激活' });
    const sites = await lockAffectedSites(tx, locked);
    const targetVersion = version ?? locked.currentVersion;
    const [versionRow] = await tx.select({ id: cmsTemplateVersions.id }).from(cmsTemplateVersions).where(and(
      eq(cmsTemplateVersions.templateId, id),
      eq(cmsTemplateVersions.version, targetVersion),
    )).limit(1);
    if (!versionRow) throw new HTTPException(404, { message: `模板版本 v${targetVersion} 不存在` });
    if (locked.status === 'enabled' && locked.activeVersion === targetVersion) {
      throw new HTTPException(409, { message: `模板 v${targetVersion} 已是活动版本` });
    }
    const [updated] = await tx.update(cmsTemplates).set({
      status: 'enabled',
      activeVersion: targetVersion,
      lifecycleRevision: sql`${cmsTemplates.lifecycleRevision} + 1`,
    }).where(eq(cmsTemplates.id, id)).returning();
    const tasks = await insertLifecycleTasks(
      tx,
      updated,
      updated.lifecycleRevision,
      sites,
      `模板 ${updated.code} v${targetVersion} 激活`,
    );
    return { updated, tasks };
  });
  await enqueueLifecycleTasks(result.tasks);
  return { template: mapCmsTemplate(result.updated), tasks: result.tasks };
}

export async function deactivateCmsTemplate(id: number) {
  const current = await db.query.cmsTemplates.findFirst({ where: eq(cmsTemplates.id, id) });
  if (!current) throw new HTTPException(404, { message: '模板不存在' });
  await assertLifecycleScope(current);
  if (!isManualTemplateLifecycleAllowed(current.source)) throw new HTTPException(400, { message: '主题包模板状态由站点活动 package deployment 派生，禁止手工停用' });
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const [locked] = await tx.select().from(cmsTemplates).where(eq(cmsTemplates.id, id)).for('update').limit(1);
    if (!locked) throw new HTTPException(404, { message: '模板不存在' });
    if (!isManualTemplateLifecycleAllowed(locked.source)) throw new HTTPException(400, { message: '主题包模板禁止手工停用' });
    if (locked.status === 'disabled' || locked.activeVersion == null) {
      throw new HTTPException(409, { message: '模板当前未激活' });
    }
    const sites = await lockAffectedSites(tx, locked);
    for (const site of sites) {
      const refs = locked.type === 'list' || locked.type === 'detail'
        ? await findCmsTemplateReferences(site.id, locked.type, locked.code)
        : [];
      if (refs.length > 0) {
        throw new HTTPException(409, { message: `模板仍被引用，不能停用：${refs.slice(0, 5).join('；')}` });
      }
    }
    const [updated] = await tx.update(cmsTemplates).set({
      status: 'disabled',
      activeVersion: null,
      lifecycleRevision: sql`${cmsTemplates.lifecycleRevision} + 1`,
    }).where(eq(cmsTemplates.id, id)).returning();
    const tasks = await insertLifecycleTasks(
      tx,
      updated,
      updated.lifecycleRevision,
      sites,
      `模板 ${updated.code} 停用`,
    );
    return { updated, tasks };
  });
  await enqueueLifecycleTasks(result.tasks);
  return { template: mapCmsTemplate(result.updated), tasks: result.tasks };
}

export async function rollbackCmsTemplate(id: number, targetVersion: number, changeNote?: string | null) {
  const current = await db.query.cmsTemplates.findFirst({ where: eq(cmsTemplates.id, id) });
  if (!current) throw new HTTPException(404, { message: '模板不存在' });
  await assertLifecycleScope(current);
  if (!isManualTemplateLifecycleAllowed(current.source)) throw new HTTPException(400, { message: '主题包模板请通过主题包版本回滚' });
  const result = await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const [locked] = await tx.select().from(cmsTemplates).where(eq(cmsTemplates.id, id)).for('update').limit(1);
    if (!locked) throw new HTTPException(404, { message: '模板不存在' });
    if (!isManualTemplateLifecycleAllowed(locked.source)) throw new HTTPException(400, { message: '主题包模板请通过主题包版本回滚' });
    const sites = await lockAffectedSites(tx, locked);
    const [source] = await tx.select().from(cmsTemplateVersions).where(and(
      eq(cmsTemplateVersions.templateId, id),
      eq(cmsTemplateVersions.version, targetVersion),
    )).limit(1);
    if (!source) throw new HTTPException(404, { message: `模板版本 v${targetVersion} 不存在` });
    const nextVersion = locked.currentVersion + 1;
    await tx.insert(cmsTemplateVersions).values({
      templateId: id,
      version: nextVersion,
      dsl: source.dsl,
      checksum: source.checksum,
      changeNote: changeNote ?? `回滚至 v${targetVersion}`,
    });
    const [updated] = await tx.update(cmsTemplates).set({
      currentVersion: nextVersion,
      activeVersion: nextVersion,
      status: 'enabled',
      lifecycleRevision: sql`${cmsTemplates.lifecycleRevision} + 1`,
    }).where(eq(cmsTemplates.id, id)).returning();
    const tasks = await insertLifecycleTasks(
      tx,
      updated,
      updated.lifecycleRevision,
      sites,
      `模板 ${updated.code} 回滚至 v${targetVersion}（新版本 v${nextVersion}）`,
    );
    return { updated, tasks };
  });
  await enqueueLifecycleTasks(result.tasks);
  return { template: mapCmsTemplate(result.updated), tasks: result.tasks };
}
