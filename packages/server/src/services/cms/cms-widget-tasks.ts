import { uniquePositiveInts } from '@zenith/shared/core';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsWidgetSourceType } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { db } from '../../db';
import { cmsWidgetRefs, cmsWidgets } from '../../db/schema';
import logger from '../../lib/logger';
import { currentUserOrNull, runWithCurrentUser } from '../../lib/context';
import { hasPermission } from '../../lib/context';
import {
  mapAsyncTask,
  registerTaskHandler,
  submitAsyncTask,
} from '../../lib/task-center';
import { customPagePath } from './cms-urls';
import {
  refreshCustomPageStatic,
  refreshHomeStatic,
} from './cms-static.service';
import { triggerCdnPurge } from './cms-cdn.service';
import {
 deleteCmsWidget,
  findPublishedWidgetIdsBySource,
 listCmsWidgetUsageTargets,
  offlineCmsWidget,
  publishCmsWidget,
} from './cms-widgets.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';

const SYSTEM_USER = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
export async function refreshCmsWidgetTargets(
  widgetIds: number[],
  homeSiteIds: number[] = [],
  onProgress?: (processed: number, total: number, note: string) => Promise<boolean>,
): Promise<{ pages: number; homes: number }> {
  const { refs, pages, sites } = await listCmsWidgetUsageTargets(widgetIds);
  const pageRefIds = new Set(refs.filter((ref) => ref.ownerType === 'page').map((ref) => ref.ownerId));
  const targetPages = pages.filter((page) => pageRefIds.has(page.id) && page.status === 'enabled');
  const targetHomeSiteIds = new Set([
    ...homeSiteIds,
    ...refs.filter((ref) => ref.ownerType === 'theme_slot' && ref.field === 'home.sidebar').map((ref) => ref.siteId),
    ...targetPages.filter((page) => page.isHome).map((page) => page.siteId),
  ]);
  const siteById = new Map(sites.map((site) => [site.id, site]));
  for (const siteId of targetHomeSiteIds) {
    if (!siteById.has(siteId)) {
      const site = await resolveEffectiveCmsSiteRow(siteId).catch(() => null);
      if (site) siteById.set(siteId, site);
    }
  }

  const total = targetPages.length + targetHomeSiteIds.size;
  let processed = 0;
  let refreshedPages = 0;
  let refreshedHomes = 0;
  for (const page of targetPages) {
    const site = await resolveEffectiveCmsSiteRow(page.siteId).catch(() => null);
    if (!site) continue;
    await refreshCustomPageStatic({
      siteId: page.siteId,
      slug: page.slug,
      isHome: page.isHome,
    });
    const paths = [customPagePath(page), ...(page.isHome ? ['', 'index.html'] : [])];
    await invalidateCmsSiteCaches(page.siteId, paths);
    if (site.staticMode === 'dynamic') triggerCdnPurge(site, paths);
    refreshedPages += 1;
    processed += 1;
    if (await onProgress?.(processed, total, `已刷新页面 ${processed}/${total}`)) {
      return { pages: refreshedPages, homes: refreshedHomes };
    }
  }

  for (const siteId of targetHomeSiteIds) {
    const site = siteById.get(siteId) ?? await resolveEffectiveCmsSiteRow(siteId).catch(() => null);
    if (!site) continue;
    if (site.staticMode !== 'dynamic') await refreshHomeStatic(site);
    await invalidateCmsSiteCaches(siteId, ['', 'index.html']);
    triggerCdnPurge(site, ['']);
    refreshedHomes += 1;
    processed += 1;
    if (await onProgress?.(processed, total, `已刷新首页 ${processed}/${total}`)) {
      return { pages: refreshedPages, homes: refreshedHomes };
    }
  }
  return { pages: refreshedPages, homes: refreshedHomes };
}

async function submitRefreshTask(
  input: { widgetIds?: number[]; homeSiteIds?: number[] },
  options?: { eventKey?: string; debounceBySite?: boolean },
): Promise<AsyncTask | null> {
  const widgetIds = uniquePositiveInts(input.widgetIds);
  let homeSiteIds = uniquePositiveInts(input.homeSiteIds);
  if (widgetIds.length === 0 && homeSiteIds.length === 0) return null;
  let idempotencyKey = options?.eventKey ? `cms-widget-refresh:${options.eventKey}` : null;
  if (options?.debounceBySite) {
    const widgetSites = widgetIds.length > 0
      ? await db.select({ siteId: cmsWidgets.siteId }).from(cmsWidgets)
        .where(inArray(cmsWidgets.id, widgetIds))
      : [];
    const siteIds = [...new Set([...homeSiteIds, ...widgetSites.map((row) => row.siteId)])].sort((a, b) => a - b);
    if (siteIds.length === 0) return null;
    const bucket = Math.floor(Date.now() / 5_000);
    homeSiteIds = siteIds;
    const siteHash = createHash('sha256').update(siteIds.join(',')).digest('hex').slice(0, 16);
    idempotencyKey = `cms-widget-refresh:site:${siteHash}:${bucket}`;
    const notBefore = (bucket + 1) * 5_000;
    const row = await submitAsyncTask({
      taskType: 'cms-widget-refresh',
      title: 'CMS 页面部件引用刷新',
      payload: {
        widgetIds: [], homeSiteIds, siteIds, notBefore,
      },
      idempotencyKey,
    });
    return mapAsyncTask(row);
  }
  const row = await submitAsyncTask({
    taskType: 'cms-widget-refresh',
    title: 'CMS 页面部件引用刷新',
    payload: { widgetIds, homeSiteIds },
    idempotencyKey,
  });
  return mapAsyncTask(row);
}

export function submitCmsWidgetRefreshSideEffect(input: {
  widgetIds?: number[];
  homeSiteIds?: number[];
  eventKey?: string;
  debounceBySite?: boolean;
}): void {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  void runWithCurrentUser(actor, () => submitRefreshTask(input, {
    eventKey: input.eventKey,
    debounceBySite: input.debounceBySite,
  }))
    .catch((error) => logger.error('[CMS] 页面部件引用刷新任务提交失败', error));
}

export function submitCmsWidgetSourceRefreshSideEffect(
  sourceType: Exclude<CmsWidgetSourceType, 'manual'>,
  sourceIds: number[],
): void {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  void runWithCurrentUser(actor, async () => {
    if (sourceIds.length === 0) return;
    const widgetIds = await findPublishedWidgetIdsBySource(sourceType, sourceIds);
    await submitRefreshTask({ widgetIds }, { debounceBySite: true });
  }).catch((error) => logger.error('[CMS] 页面部件实时来源刷新任务提交失败', error));
}

export function submitCmsWidgetChannelRefreshSideEffect(channelIds: number[]): void {
  const actor = currentUserOrNull() ?? SYSTEM_USER;
  void runWithCurrentUser(actor, async () => {
   if (channelIds.length === 0) return;
    const widgetIds = await findPublishedWidgetIdsBySource('channel', channelIds);
    await submitRefreshTask({ widgetIds }, { debounceBySite: true });
  }).catch((error) => logger.error('[CMS] 页面部件栏目来源刷新任务提交失败', error));
}

export async function submitCmsWidgetBatchTask(input: {
  ids: number[];
  action: 'publish' | 'offline' | 'delete';
}) {
  const permission = `cms:widget:${input.action}`;
  if (!(await hasPermission(permission))) {
    throw new Error(`缺少 ${permission} 权限`);
  }
  const row = await submitAsyncTask({
    taskType: 'cms-widget-batch',
    title: `页面部件批量${input.action === 'publish' ? '发布' : input.action === 'offline' ? '下线' : '删除'}`,
    payload: {
      ids: [...new Set(input.ids)].sort((a, b) => a - b),
      action: input.action,
    },
    idempotencyKey: null,
  });
  return mapAsyncTask(row);
}

export function registerCmsWidgetTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'cms-widget-refresh',
    title: 'CMS 页面部件引用刷新',
    module: 'CMS内容管理',
    description: '按页面部件反向引用定向刷新搭建页面、首页、Redis 页面缓存与 CDN。',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const payload = ctx.payload as {
        widgetIds?: number[];
        homeSiteIds?: number[];
        siteIds?: number[];
        notBefore?: number;
      };
      const waitMs = Math.max(0, Number(payload.notBefore ?? 0) - Date.now());
      if (waitMs > 0) {
        const state = await ctx.progress({
          processed: 0,
          total: null,
          note: '正在合并同一站点的连续变更…',
        });
        if (state.cancelRequested) return { pages: 0, homes: 0 };
        await delay(Math.min(waitMs, 5_000));
        if (await ctx.isCancelRequested()) return { pages: 0, homes: 0 };
      }
      const siteWidgetRows = payload.siteIds?.length
        ? await db.select({ id: cmsWidgets.id }).from(cmsWidgets).where(and(
            inArray(cmsWidgets.siteId, payload.siteIds),
            eq(cmsWidgets.status, 'published'),
          ))
        : [];
      const widgetIds = [...new Set([
        ...(payload.widgetIds ?? []),
        ...siteWidgetRows.map((row) => row.id),
      ])];
      return refreshCmsWidgetTargets(
        widgetIds,
        payload.homeSiteIds ?? [],
        async (processed, total, note) => {
          const state = await ctx.progress({ processed, total, note, checkpoint: { processed } });
          return state.cancelRequested;
        },
      );
    },
  });

  registerTaskHandler({
    taskType: 'cms-widget-batch',
    title: 'CMS 页面部件批量操作',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const payload = ctx.payload as { ids?: number[]; action?: 'publish' | 'offline' | 'delete' };
      const ids = [...new Set(payload.ids ?? [])].sort((a, b) => a - b);
      const action = payload.action;
      if (!action || ids.length === 0) throw new Error('缺少页面部件批量操作参数');
      const permission = `cms:widget:${action}`;
      if (!(await hasPermission(permission))) throw new Error(`任务创建者缺少 ${permission} 权限`);
     let processed = Number(ctx.checkpoint?.processed ?? 0);
      let succeeded = Number(ctx.checkpoint?.succeeded ?? 0);
      let failed = Number(ctx.checkpoint?.failed ?? 0);
      let skipped = Number(ctx.checkpoint?.skipped ?? 0);
      const refreshIds = action === 'delete' ? [] : ids;
      for (let index = processed; index < ids.length; index++) {
        const id = ids[index];
        try {
          if (action === 'publish') {
            await publishCmsWidget(id, { suppressRefresh: true });
          } else if (action === 'offline') {
            await offlineCmsWidget(id, { suppressRefresh: true, allowAlreadyOffline: true });
          } else {
            try {
              await deleteCmsWidget(id);
            } catch (error) {
              if (!(error instanceof HTTPException && error.status === 404)) throw error;
            }
          }
          succeeded += 1;
          await ctx.reportItems([{ key: `widget-${id}`, label: `页面部件 #${id}`, status: 'success', message: null }]);
        } catch (error) {
          const isBusinessBlock = error instanceof HTTPException && error.status === 409;
          if (isBusinessBlock) skipped += 1;
          else failed += 1;
          await ctx.reportItems([{
            key: `widget-${id}`,
            label: `页面部件 #${id}`,
            status: isBusinessBlock ? 'skipped' : 'failed',
            message: error instanceof Error ? error.message.slice(0, 200) : '操作失败',
          }]);
        }
        processed = index + 1;
        const state = await ctx.progress({
          processed,
          total: ids.length,
          failed,
          note: `已处理 ${processed}/${ids.length}，成功 ${succeeded}，跳过 ${skipped}，失败 ${failed}`,
          checkpoint: { processed, succeeded, failed, skipped },
        });
        if (state.cancelRequested) {
          if (refreshIds.length > 0) await refreshCmsWidgetTargets(refreshIds);
          return {
            processed, succeeded, failed, skipped,
          };
        }
      }
      if (refreshIds.length > 0) await refreshCmsWidgetTargets(refreshIds);
      return {
        processed, succeeded, failed, skipped,
      };
    },
  });
}

export async function removeStaleCmsPageWidgetRefs(pageIds: number[]): Promise<void> {
  if (pageIds.length === 0) return;
  await db.delete(cmsWidgetRefs).where(and(
    eq(cmsWidgetRefs.ownerType, 'page'),
    inArray(cmsWidgetRefs.ownerId, pageIds),
  ));
}
