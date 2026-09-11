import path from 'node:path';
import fs from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, and, gt, inArray, isNull, isNotNull, lte, or, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
 cmsAds, cmsAdSlots, cmsChannels, cmsContents, cmsInteractions,
  cmsPages, cmsContentTags, cmsContentChannels, cmsContentTombstones, cmsWidgets, cmsTags, cmsSites, cmsPublishArtifacts, asyncTasks,
} from '../../db/schema';
import type { CmsSiteRow, CmsChannelRow } from '../../db/schema';
import logger from '../../lib/logger';
import { formatIso8601 } from '../../lib/datetime';
import type { CmsContentPublishSnapshot, CmsStaticMode } from '@zenith/shared/cms';
import { TaskCancelledError } from '../../lib/task-center';
import {
  renderSitePath, renderHomePage, renderChannelPage, renderDetailPage, renderTagPage, renderCustomPage,
  channelUrl, contentUrl, tagUrl, customPageUrl, customPagePath, siteOrigin, listSiteTags, generateRssXml, countContentBodyPages, splitBodyPages,
} from './cms-render.service';
import { triggerCdnPurge, triggerCdnPurgeAll } from './cms-cdn.service';

// ─── 静态目录 ─────────────────────────────────────────────────────────────────
import {
  CMS_STATIC_ROOT, isStrictlyWithin, pathToStaticFile, resolveStaticFile, siteStaticDir,
} from './cms-static-path';
import { assertSiteAccess } from './cms-sites.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import type { CmsUrlChannel } from './cms-urls';
import { resolveCmsSiteOpsSettings } from './cms-site-settings';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { recordCmsPublishArtifact } from './cms-publish-artifact-tracker';
import { cmsStaticTargetKey, isCmsStaticTargetCompleted } from './cms-static-build-plan';
import { assertCmsStaticWriteFence } from './cms-site-publish-lock.service';
import { invalidateCmsSiteCaches } from './cms-cache.service';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
export {
  CMS_STATIC_ROOT, isStrictlyWithin, pathToStaticFile, resolveStaticFile, siteStaticDir,
} from './cms-static-path';

export async function ensureCmsStaticBuildAccess(siteId: number): Promise<CmsSiteRow> {
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  return resolveEffectiveCmsSiteRow(siteId);
}

export async function readStaticFile(siteCode: string, relPath: string): Promise<string | null> {
  const abs = resolveStaticFile(siteCode, relPath);
  if (!abs) return null;
  try {
    return await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Check the database owner of a static path before serving a stale artifact.
 * A publish worker may be delayed or failed, so disk presence alone is not a
 * public-visibility decision.
 */
export async function isCmsStaticArtifactCurrent(siteId: number, siteCode: string, relPath: string): Promise<boolean> {
  const pathKey = relPath.replace(/^\/+|\/+$/g, '').replace(/^index\.html$/i, '');
  const effectiveSite = await resolveEffectiveCmsSiteRow(siteId).catch(() => null);
  if (!effectiveSite) return false;
  const effectiveChannels = await getEffectivelyEnabledCmsChannelIds(siteId);
  const now = new Date();
  const staticFile = resolveStaticFile(siteCode, relPath);
  let generatedAt = 0;
  if (staticFile) {
    try { generatedAt = (await fs.stat(staticFile)).mtimeMs; } catch { return false; }
  }
  const [siteRevision] = await db.select({ publicRevision: cmsSites.publicRevision }).from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!siteRevision) return false;
  const artifactPath = pathKey && !pathKey.includes('.')
    ? `${pathKey}/index.html`
    : pathKey || 'index.html';
  const [artifact] = await db.select({
    publicRevision: cmsPublishArtifacts.publicRevision,
    status: cmsPublishArtifacts.status,
    targetType: cmsPublishArtifacts.targetType,
    taskId: cmsPublishArtifacts.taskId,
  })
    .from(cmsPublishArtifacts)
    .where(and(
      eq(cmsPublishArtifacts.siteId, siteId),
      eq(cmsPublishArtifacts.path, artifactPath),
    ))
    .orderBy(sql`coalesce(${cmsPublishArtifacts.generatedAt}, ${cmsPublishArtifacts.updatedAt}) desc`, desc(cmsPublishArtifacts.id))
    .limit(1);
  // A full-site artifact represents the whole public snapshot, so its
  // revision must match exactly. Path-scoped content artifacts are checked
  // against their owner timestamps below; a global equality check here would
  // incorrectly invalidate unrelated pages after every content publish.
  if (artifact && (artifact.status !== 'generated'
    || (artifact.targetType === 'site' && artifact.publicRevision !== siteRevision.publicRevision))) return false;
  const aggregateRoute = pathKey === ''
    || pathKey === 'sitemap.xml'
    || pathKey === 'rss.xml'
    || pathKey === 'robots.txt'
    || pathKey.startsWith('tag/');
  if (aggregateRoute && artifact && artifact.publicRevision !== siteRevision.publicRevision) return false;
 if (artifact) {
   const [task] = await db.select({ status: asyncTasks.status }).from(asyncTasks)
     .where(eq(asyncTasks.id, artifact.taskId)).limit(1);
   // A failed/cancelled/in-flight build may have left a subset of files on
   // disk. Do not expose that partial deployment as a current artifact.
   if (!task || task.status !== 'success') return false;
 }
  // A site/theme task is a whole-public-snapshot barrier. Until the task
  // for the current revision succeeds and writes this path, an older
  // path-scoped artifact must not leak the previous site configuration.
  const [fullRevisionTask] = await db.select({ status: asyncTasks.status }).from(asyncTasks)
    .where(and(
      eq(asyncTasks.taskType, 'cms-publish-build'),
      sql`${asyncTasks.payload}->>'siteId' = ${String(siteId)}`,
      sql`(${asyncTasks.payload}->>'targetType') in ('site', 'theme')`,
      sql`case when (${asyncTasks.payload}->>'expectedPublicRevision') ~ '^[0-9]+$' then (${asyncTasks.payload}->>'expectedPublicRevision')::int else null end = ${siteRevision.publicRevision}`,
    )).orderBy(desc(asyncTasks.id)).limit(1);
  if (fullRevisionTask) {
    if (fullRevisionTask.status !== 'success') return false;
    if (!artifact || artifact.publicRevision !== siteRevision.publicRevision) return false;
  }
  const generatedDate = new Date(generatedAt);
  const [transitionedContent, transitionedAd, transitionedInteraction] = await Promise.all([
    db.select({ id: cmsContents.id }).from(cmsContents).where(and(
      eq(cmsContents.siteId, siteId),
      or(
        and(isNotNull(cmsContents.expireAt), gt(cmsContents.expireAt, generatedDate), lte(cmsContents.expireAt, now)),
        and(isNotNull(cmsContents.topExpireAt), gt(cmsContents.topExpireAt, generatedDate), lte(cmsContents.topExpireAt, now)),
      ),
    )).limit(1),
    db.select({ id: cmsAds.id }).from(cmsAds).innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id)).where(and(
      eq(cmsAdSlots.siteId, siteId),
      or(
        and(isNotNull(cmsAds.startAt), gt(cmsAds.startAt, generatedDate), lte(cmsAds.startAt, now)),
        and(isNotNull(cmsAds.endAt), gt(cmsAds.endAt, generatedDate), lte(cmsAds.endAt, now)),
      ),
    )).limit(1),
    db.select({ id: cmsInteractions.id }).from(cmsInteractions).where(and(
      eq(cmsInteractions.siteId, siteId),
      or(
        and(isNotNull(cmsInteractions.startAt), gt(cmsInteractions.startAt, generatedDate), lte(cmsInteractions.startAt, now)),
        and(isNotNull(cmsInteractions.endAt), gt(cmsInteractions.endAt, generatedDate), lte(cmsInteractions.endAt, now)),
      ),
    )).limit(1),
  ]);
  if (transitionedContent.length > 0 || transitionedAd.length > 0 || transitionedInteraction.length > 0) return false;

  const [page] = await db.select({ status: cmsPages.status, requiresDynamic: cmsPages.requiresDynamic, isHome: cmsPages.isHome, path: cmsPages.path, blocks: cmsPages.blocks, updatedAt: cmsPages.updatedAt })
   .from(cmsPages).where(and(eq(cmsPages.siteId, siteId), pathKey === '' ? eq(cmsPages.isHome, true) : eq(cmsPages.path, pathKey))).limit(1);
  if (page) {
    if (page.status !== 'enabled' || page.requiresDynamic || page.updatedAt.getTime() > generatedAt) return false;
    const blocks = Array.isArray(page.blocks) ? page.blocks as Array<{ type?: unknown }> : [];
    const hasLiveData = blocks.some((block) => block?.type === 'content-list' || block?.type === 'widget-ref');
    if (hasLiveData) {
      const [changedContent, changedWidget] = await Promise.all([
        db.select({ id: cmsContents.id }).from(cmsContents).where(and(
          eq(cmsContents.siteId, siteId),
          gt(cmsContents.updatedAt, generatedDate),
        )).limit(1),
       db.select({ id: cmsWidgets.id }).from(cmsWidgets).where(and(
         eq(cmsWidgets.siteId, siteId),
         gt(cmsWidgets.updatedAt, generatedDate),
        )).limit(1),
      ]);
      if (changedContent.length > 0 || changedWidget.length > 0) return false;
    }
    return true;
  }

  const channelKey = pathKey === '' ? null
    : pathKey.replace(/\/index(?:_\d+)?\.html$/i, '').replace(/\/rss\.xml$/i, '');
  if (channelKey) {
    const [channel] = await db.select({ id: cmsChannels.id, status: cmsChannels.status, path: cmsChannels.path, type: cmsChannels.type, staticMode: cmsChannels.staticMode, updatedAt: cmsChannels.updatedAt })
      .from(cmsChannels).where(and(eq(cmsChannels.siteId, siteId), eq(cmsChannels.path, channelKey))).limit(1);
   if (channel) {
      const [changedMain, changedExtra] = await Promise.all([
        db.select({ id: cmsContents.id }).from(cmsContents).where(and(
          eq(cmsContents.siteId, siteId),
          eq(cmsContents.channelId, channel.id),
          gt(cmsContents.updatedAt, generatedDate),
        )).limit(1),
        db.select({ id: cmsContentChannels.contentId }).from(cmsContentChannels)
          .innerJoin(cmsContents, eq(cmsContentChannels.contentId, cmsContents.id))
          .where(and(
            eq(cmsContentChannels.channelId, channel.id),
            eq(cmsContents.siteId, siteId),
            gt(cmsContents.updatedAt, generatedDate),
          )).limit(1),
      ]);
      return channel.status === 'enabled'
        && effectiveChannels.has(channel.id)
        && channel.type === 'list'
        && resolveChannelStaticMode(effectiveSite, channel) !== 'dynamic'
        && channel.updatedAt.getTime() <= generatedAt
        && changedMain.length === 0 && changedExtra.length === 0;
    }
  }

  const basePath = pathKey.replace(/_(\d+)\.html$/i, '.html');
  const fileName = basePath.split('/').pop() ?? '';
  const stem = fileName.replace(/\.html$/i, '');
  const numericId = /^\d+$/.test(stem) ? Number(stem) : null;
  const [exactCustom] = await db.select().from(cmsContents).where(and(
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.staticPath, basePath),
  )).limit(1);
  const contentCandidates = exactCustom ? [exactCustom] : await db.select().from(cmsContents).where(and(
    eq(cmsContents.siteId, siteId),
    numericId != null ? eq(cmsContents.id, numericId) : eq(cmsContents.slug, stem),
  )).limit(2);
  const channels = contentCandidates.length > 0
    ? await db.select({ id: cmsChannels.id, path: cmsChannels.path, type: cmsChannels.type, detailPathRule: cmsChannels.detailPathRule, staticMode: cmsChannels.staticMode })
      .from(cmsChannels).where(inArray(cmsChannels.id, contentCandidates.map((candidate) => candidate.channelId)))
    : [];
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const requestedPage = /_(\d+)\.html$/i.exec(pathKey);
  const content = contentCandidates.find((candidate) => {
    const channel = channelById.get(candidate.channelId);
    if (!channel || !effectiveChannels.has(channel.id)
      || channel.type !== 'list'
      || resolveChannelStaticMode(effectiveSite, channel) === 'dynamic') return false;
    if (candidate.updatedAt.getTime() > generatedAt) return false;
    const canonical = candidate.staticPath ?? contentUrl('', channel, candidate);
    const canonicalKey = canonical.replace(/^\/+/, '');
    const expected = requestedPage
      ? `${canonicalKey.replace(/\.html$/i, '')}_${requestedPage[1]}.html`
      : canonicalKey;
    return expected === pathKey;
  });
  if (content) {
    return content.status === 'published'
      && content.deletedAt == null
      && (content.expireAt == null || content.expireAt > now)
      && effectiveChannels.has(content.channelId)
      && !content.externalLink?.trim();
  }
  if (aggregateRoute) {
    const [changedContent, changedChannel, changedPage, changedTombstone] = await Promise.all([
      db.select({ id: cmsContents.id }).from(cmsContents).where(and(
        eq(cmsContents.siteId, siteId),
        gt(cmsContents.updatedAt, generatedDate),
      )).limit(1),
      db.select({ id: cmsChannels.id }).from(cmsChannels).where(and(
        eq(cmsChannels.siteId, siteId),
        gt(cmsChannels.updatedAt, generatedDate),
      )).limit(1),
      db.select({ id: cmsPages.id }).from(cmsPages).where(and(
        eq(cmsPages.siteId, siteId),
        gt(cmsPages.updatedAt, generatedDate),
      )).limit(1),
      db.select({ id: cmsContentTombstones.id }).from(cmsContentTombstones).where(and(
        eq(cmsContentTombstones.siteId, siteId),
        gt(cmsContentTombstones.deletedAt, generatedDate),
      )).limit(1),
    ]);
    if (changedContent.length > 0 || changedChannel.length > 0 || changedPage.length > 0 || changedTombstone.length > 0) return false;
  }
  if (aggregateRoute && pathKey.startsWith('tag/')) {
    const tagSlug = pathKey.slice('tag/'.length).replace(/\/index(?:_\d+)?\.html$/i, '').replace(/\/+$/, '');
    const [tag] = await db.select({ id: cmsTags.id }).from(cmsTags).where(and(
      eq(cmsTags.siteId, siteId),
      eq(cmsTags.slug, tagSlug),
    )).limit(1);
    if (!tag) return false;
  }
 // A disk file without a current database owner is an orphan. Never serve
 // it merely because a legacy task left it behind; hybrid mode will SSR
 // the request and a subsequent publish can recreate the artifact.
  return aggregateRoute ? true : false;
}

/** Reject a hybrid write when any public owner changed while SSR was running. */
export async function assertCmsHybridWriteSafe(siteId: number, startedAt: Date): Promise<void> {
  const [site, changedContent, changedChannel, changedPage, changedWidget] = await Promise.all([
    db.select({ updatedAt: cmsSites.updatedAt }).from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1),
    db.select({ id: cmsContents.id }).from(cmsContents).where(and(
      eq(cmsContents.siteId, siteId),
      gt(cmsContents.updatedAt, startedAt),
    )).limit(1),
    db.select({ id: cmsChannels.id }).from(cmsChannels).where(and(
      eq(cmsChannels.siteId, siteId),
      gt(cmsChannels.updatedAt, startedAt),
    )).limit(1),
    db.select({ id: cmsPages.id }).from(cmsPages).where(and(
      eq(cmsPages.siteId, siteId),
      gt(cmsPages.updatedAt, startedAt),
    )).limit(1),
    db.select({ id: cmsWidgets.id }).from(cmsWidgets).where(and(
      eq(cmsWidgets.siteId, siteId),
      gt(cmsWidgets.updatedAt, startedAt),
    )).limit(1),
  ]);
  if (!site[0] || site[0].updatedAt > startedAt
    || changedContent.length > 0 || changedChannel.length > 0
    || changedPage.length > 0 || changedWidget.length > 0) {
    throw new TaskCancelledError('SSR 期间公开数据发生变化，放弃 hybrid 静态回写', {
      stale: true,
      siteId,
    });
  }
}

/** 原子写入：先写临时文件再 rename，避免读到半个页面 */
export async function writeStaticFile(siteCode: string, relPath: string, html: string): Promise<void> {
  const abs = resolveStaticFile(siteCode, relPath);
  if (!abs) return;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  let previous: Buffer | null = null;
  try { previous = await fs.readFile(abs); } catch { /* no previous artifact */ }
  let renamed = false;
  try {
    await fs.writeFile(tmp, html, 'utf8');
    await assertCmsStaticWriteFence();
   await fs.rename(tmp, abs);
    renamed = true;
   buildWriteCollector.getStore()?.add(normalizeStaticRelPath(relPath));
    await recordCmsPublishArtifact({ relPath, status: 'generated', content: html });
 } catch (error) {
   await fs.rm(tmp, { force: true }).catch(() => undefined);
    if (renamed) {
      if (previous) await fs.writeFile(abs, previous).catch(() => undefined);
      else await fs.rm(abs, { force: true }).catch(() => undefined);
    }
   await recordCmsPublishArtifact({
      relPath,
      status: 'failed',
      error: error instanceof Error ? error.message : '写入静态产物失败',
    }).catch(() => undefined);
    throw error;
  }
}

export async function deleteStaticFile(siteCode: string, relPath: string): Promise<boolean> {
  const abs = resolveStaticFile(siteCode, relPath);
  if (!abs) return false;
  let previous: Buffer | null = null;
  let removed = false;
  try {
    try {
      previous = await fs.readFile(abs);
      await fs.lstat(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    await assertCmsStaticWriteFence();
    await fs.rm(abs, { force: true });
    removed = true;
    await recordCmsPublishArtifact({ relPath, status: 'deleted' });
    return true;
  } catch (error) {
    if (removed && previous) await fs.writeFile(abs, previous).catch(() => undefined);
    await recordCmsPublishArtifact({
      relPath,
      status: 'failed',
      error: error instanceof Error ? error.message : '删除静态产物失败',
    }).catch(() => undefined);
    throw error;
  }
}

/** 清空站点静态目录（全量重建前调用） */
export async function clearSiteStatic(siteCode: string): Promise<void> {
  const dir = siteStaticDir(siteCode);
  if (!isStrictlyWithin(CMS_STATIC_ROOT, dir)) throw new Error('CMS 站点静态目录越界');
  await assertCmsStaticWriteFence();
  await fs.rm(dir, { recursive: true, force: true });
}

// ─── 孤儿产物清扫（全量重建的 mark & sweep）─────────────────────────────────────
/**
 * 本次构建写入的相对路径集合。
 *
 * 用 AsyncLocalStorage 而非层层透传：写文件散落在 writeRenderedPath / regenerateChannelPages /
 * refreshHomeStatic 等多个 helper 中，透传参数既啰嗦又容易漏，漏一处就会把有效产物
 * 误判成孤儿删掉。与 cms-publish-artifact-tracker 采用同一模式，且天然按调用栈隔离，
 * 多站点/并发构建互不串扰。
 */
const buildWriteCollector = new AsyncLocalStorage<Set<string>>();

/**
 * 统一成磁盘上的实际相对路径，供集合比对。
 *
 * 必须复用 `pathToStaticFile`：写入侧记的是 URL 形态（`news/`、``），
 * 磁盘上却是 `news/index.html`、`index.html`。只做斜杠归一会让首页/栏目页
 * 在集合里查不到，被当成孤儿全部删掉。
 */
function normalizeStaticRelPath(relPath: string): string {
  try {
    return pathToStaticFile(relPath).replaceAll('\\', '/');
  } catch {
    return relPath.replaceAll('\\', '/').replace(/^\/+/, '');
  }
}

/** 递归列出站点静态目录下的全部文件（返回归一化相对路径） */
async function listSiteStaticFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listSiteStaticFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

/** 自底向上删除空目录（清扫后残留的空壳目录，如改归档规则后的旧年份目录） */
async function removeEmptyDirs(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(path.join(dir, entry.name));
  }
  const rest = await fs.readdir(dir).catch(() => ['keep']);
  if (rest.length === 0) await fs.rmdir(dir).catch(() => undefined);
}

/**
 * 清扫孤儿产物：删除站点静态目录下本次全量构建未写入的文件。
 *
 * 只在「未断点续跑、且完整跑完」的整站重建后调用 —— 续跑/取消时 kept 集合不完整，
 * 清扫会误删有效产物。删除走 deleteStaticFile，因此同样受发布围栏保护并留下 deleted 产物记录。
 */
export async function pruneOrphanStaticFiles(siteCode: string, kept: ReadonlySet<string>): Promise<number> {
  const dir = siteStaticDir(siteCode);
  if (!isStrictlyWithin(CMS_STATIC_ROOT, dir)) throw new Error('CMS 站点静态目录越界');
  // 入参可能混用 URL 形态（`news/`）与磁盘形态（`news/index.html`），统一归一后再比对
  const keptFiles = new Set([...kept].map(normalizeStaticRelPath));
  const existing = await listSiteStaticFiles(dir);
  let removed = 0;
  for (const relPath of existing) {
    // 主题样式资产由渲染管线按内容指纹管理（_assets/theme.{hash}.css），不属于页面产物清单
    if (relPath.startsWith('_assets/')) continue;
    if (keptFiles.has(relPath)) continue;
    if (await deleteStaticFile(siteCode, relPath)) removed += 1;
  }
  if (removed > 0) await removeEmptyDirs(dir);
  return removed;
}

// ─── sitemap / robots ─────────────────────────────────────────────────────────
function xmlEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** 生成站点 sitemap.xml（首页 + 栏目首屏 + 已发布内容，上限 5 万条） */
export async function generateSitemapXml(site: CmsSiteRow): Promise<string> {
  const origin = siteOrigin(site) ?? '';
  const entries: { loc: string; lastmod: string | null; priority: string }[] = [];
  entries.push({ loc: `${origin}/`, lastmod: formatIso8601(new Date()), priority: '1.0' });
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(site.id);

  const channels = await db.select().from(cmsChannels)
    .where(and(
      eq(cmsChannels.siteId, site.id),
      eq(cmsChannels.status, 'enabled'),
      effectiveChannelIds.size > 0 ? inArray(cmsChannels.id, [...effectiveChannelIds]) : sql`false`,
    ));
  const channelPathMap = new Map<number, CmsUrlChannel>();
  for (const ch of channels) {
    channelPathMap.set(ch.id, { path: ch.path, detailPathRule: ch.detailPathRule });
    if (ch.type === 'link') continue;
    entries.push({ loc: `${origin}${channelUrl('', ch.path, 1)}`, lastmod: formatIso8601(ch.updatedAt), priority: '0.8' });
  }

  const contents = await db.select({
    id: cmsContents.id,
    slug: cmsContents.slug,
    staticPath: cmsContents.staticPath,
    channelId: cmsContents.channelId,
    publishedAt: cmsContents.publishedAt,
    createdAt: cmsContents.createdAt,
    externalLink: cmsContents.externalLink,
  })
    .from(cmsContents)
    .where(and(
      eq(cmsContents.siteId, site.id),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.archivedAt),
      or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
      effectiveChannelIds.size > 0 ? inArray(cmsContents.channelId, [...effectiveChannelIds]) : sql`false`,
    ))
    .limit(50000);
  for (const row of contents) {
    if (row.externalLink?.trim()) continue;
    const urlChannel = channelPathMap.get(row.channelId);
    if (!urlChannel) continue;
    entries.push({ loc: `${origin}${contentUrl('', urlChannel, row)}`, lastmod: formatIso8601(row.publishedAt), priority: '0.6' });
  }

  // 标签聚合页
  const publicTagRows = effectiveChannelIds.size > 0
    ? await db.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags)
      .innerJoin(cmsContents, eq(cmsContentTags.contentId, cmsContents.id))
      .where(and(
        eq(cmsContents.siteId, site.id),
        eq(cmsContents.status, 'published'),
        isNull(cmsContents.deletedAt),
        isNull(cmsContents.archivedAt),
        or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
        inArray(cmsContents.channelId, [...effectiveChannelIds]),
      ))
    : [];
  const publicTagIds = new Set(publicTagRows.map((row) => row.tagId));
  const tags = await listSiteTags(site.id);
  for (const tag of tags) {
    if (!publicTagIds.has(tag.id)) continue;
    entries.push({ loc: `${origin}${tagUrl('', tag.slug, 1)}`, lastmod: null, priority: '0.4' });
  }

  // 可视化搭建页面
  const { listPublishedPages } = await import('./cms-pages.service');
  for (const page of await listPublishedPages(site.id)) {
    if (page.isHome) continue; // 首页接管已由 '/' 收录
    entries.push({ loc: `${origin}${customPageUrl('', page)}`, lastmod: formatIso8601(page.updatedAt), priority: '0.7' });
  }

  const body = entries.map((e) => [
    '  <url>',
    `    <loc>${xmlEscape(e.loc)}</loc>`,
    e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : '',
    `    <priority>${e.priority}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildRobotsTxt(site: CmsSiteRow): string {
  if (site.robots?.trim()) return site.robots;
  const origin = siteOrigin(site);
  return [
    'User-agent: *',
    'Allow: /',
    ...(origin ? [`Sitemap: ${origin}/sitemap.xml`] : []),
    '',
  ].join('\n');
}

// ─── 增量静态化 ───────────────────────────────────────────────────────────────
const MAX_LIST_PAGES = 50;

/**
 * 栏目实际生效的静态化模式：栏目 `inherit` 时跟随站点，否则覆盖站点设置。
 * 判空返回 true 表示该栏目不产出静态文件（纯动态渲染）。
 */
export function resolveChannelStaticMode(
  site: Pick<CmsSiteRow, 'staticMode'>,
  channel: Pick<CmsChannelRow, 'staticMode'>,
): CmsStaticMode {
  return channel.staticMode === 'inherit' ? site.staticMode : channel.staticMode;
}

/** 栏目是否跳过静态化（纯动态） */
export function isChannelDynamic(
  site: Pick<CmsSiteRow, 'staticMode'>,
  channel: Pick<CmsChannelRow, 'staticMode'>,
): boolean {
  return resolveChannelStaticMode(site, channel) === 'dynamic';
}

/** 站点「发布内容时重建列表页数上限」（0 = 不限制） */
function listPageCap(site: Pick<CmsSiteRow, 'settings'>): number {
  const cap = resolveCmsSiteOpsSettings(site.settings).maxPageOnContentPublish;
  return cap > 0 ? Math.min(cap, MAX_LIST_PAGES) : MAX_LIST_PAGES;
}

async function writeRenderedPath(site: CmsSiteRow, relPath: string): Promise<boolean> {
  const result = await renderSitePath(site, '', relPath);
  if (result.status === 200) {
    await writeStaticFile(site.code, relPath, result.html);
    return true;
  }

  if (result.status === 404) {
    await deleteStaticFile(site.code, relPath);
  }
  return false;
}

export async function refreshHomeStatic(site: CmsSiteRow): Promise<boolean> {
  await invalidateCmsSiteCaches(site.id);
  if (site.staticMode === 'dynamic') return false;
  const { getHomeTakeoverPage } = await import('./cms-pages.service');
  const takeover = await getHomeTakeoverPage(site.id);
  const staticPath = '';
  if (takeover?.requiresDynamic) {
    await deleteStaticFile(site.code, staticPath);
    return false;
  }
  const home = await renderHomePage(site, '');
  if (home.status !== 200) {
    await deleteStaticFile(site.code, staticPath);
    return false;
  }
  await writeStaticFile(site.code, staticPath, home.html);
  return true;
}

/**
 * 重新生成栏目的全部分页列表（超出的旧分页文件删除）。
 * `pageCap` 用于站点「发布内容时重建列表页数上限」，仅限制本次重建的页数，不影响历史分页清理。
 */
async function regenerateChannelPages(
  site: CmsSiteRow,
  channel: CmsChannelRow,
  pageCap = MAX_LIST_PAGES,
): Promise<number> {
  if (channel.type === 'link') return 0;
  if (isChannelDynamic(site, channel)) return 0;
  let generated = 0;
  const first = await renderChannelPage(site, '', channel, 1);
  if (first.status !== 200) return 0;
  await writeStaticFile(site.code, `${channel.path}/`, first.html);
  generated += 1;
  if (channel.type === 'page') return generated;

  const total = await db.$count(cmsContents, and(
    eq(cmsContents.siteId, site.id),
    eq(cmsContents.channelId, channel.id),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
  ));
  const totalPages = Math.min(Math.max(1, Math.ceil(total / channel.pageSize)), MAX_LIST_PAGES);
  const buildPages = Math.min(totalPages, Math.max(1, pageCap));
  for (let p = 2; p <= buildPages; p++) {
    const result = await renderChannelPage(site, '', channel, p);
    if (result.status === 200) {
      await writeStaticFile(site.code, `${channel.path}/index_${p}.html`, result.html);
      generated += 1;
    }
  }
  // 清掉超出当前页数的历史分页
  for (let p = totalPages + 1; p <= MAX_LIST_PAGES; p++) {
    await deleteStaticFile(site.code, `${channel.path}/index_${p}.html`);
  }
  return generated;
}

/**
 * 内容发布/更新/下线后的增量静态化：
 * 详情页 + 所属栏目全部分页 + 首页 + sitemap。
 * 站点或所属栏目为 dynamic 时跳过详情页产物；列表页重建页数受站点 maxPageOnContentPublish 限制。
 */
export async function refreshContentStatic(contentId: number): Promise<void> {
  const [content] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!content) return;
  const site = await resolveEffectiveCmsSiteRow(content.siteId).catch(() => null);
  if (!site) return;
  if (site.staticMode === 'dynamic') {
    await invalidateCmsSiteCaches(site.id);
    return;
  }
  const [channel] = await db.select().from(cmsChannels).where(and(
    eq(cmsChannels.id, content.channelId),
  )).limit(1);
  if (!channel) return;

  const detailPath = contentUrl('', channel, content);
  // 栏目关闭静态化：清掉可能存在的历史产物后不再生成
  const channelDynamic = isChannelDynamic(site, channel);
  // 归档内容仍保留规范详情页；它只从列表/聚合位消失。过期内容则立即停止生成。
  const isVisible = !channelDynamic
    && content.status === 'published'
    && !content.deletedAt
    && (!content.expireAt || content.expireAt > new Date())
    && !content.externalLink?.trim();
  const bodyPages = isVisible ? await countContentBodyPages(content, content.siteId) : 1;
  const pageCap = listPageCap(site);
  const purgePaths: string[] = ['sitemap.xml', 'rss.xml'];
  if (isVisible) {
    for (let p = 1; p <= bodyPages; p++) {
      const result = await renderDetailPage(site, '', channel, String(content.slug ?? content.id), p);
      if (result.status === 200) await writeStaticFile(site.code, contentUrl('', channel, content, p), result.html);
    }
  } else {
    await deleteStaticFile(site.code, detailPath);
  }
  // 清理已收缩/下线的多余分页文件（best-effort，窗口 5 页）
  for (let p = Math.max(2, bodyPages + 1); p <= bodyPages + 5; p++) {
    await deleteStaticFile(site.code, contentUrl('', channel, content, p));
  }

  await regenerateChannelPages(site, channel, pageCap);
  await refreshHomeStatic(site);
  // CDN 刷新路径：详情页（含正文分页）+ 栏目列表页 + 首页
  for (let p = 1; p <= bodyPages; p++) {
    purgePaths.push(contentUrl('', channel, content, p));
  }
  purgePaths.push(channelUrl('', channel.path, 1));
  purgePaths.push('');
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
  triggerCdnPurge(site, purgePaths);
}

/** 按事务内冻结的路径/版本快照执行内容发布，不依赖已删除行推导旧路径。 */
export async function applyCmsContentPublishSnapshot(
  snapshot: CmsContentPublishSnapshot,
  deletePaths: readonly string[],
): Promise<void> {
  const site = await resolveEffectiveCmsSiteRow(snapshot.siteId).catch(() => null);
  if (!site) throw new TaskCancelledError(`内容 #${snapshot.contentId} 所属站点已删除`, { stale: true });
  const [currentRow] = snapshot.purged
    ? [null]
    : await db.select().from(cmsContents).where(eq(cmsContents.id, snapshot.contentId)).limit(1);
  const current = currentRow ?? null;
  if (!snapshot.purged && (!current || current.version !== snapshot.contentVersion)) {
    throw new TaskCancelledError(
      `内容 #${snapshot.contentId} 发布快照已过期（期望版本 ${snapshot.contentVersion}，当前 ${current?.version ?? 'missing'}）`,
      { stale: true, contentId: snapshot.contentId, expectedVersion: snapshot.contentVersion },
    );
  }
  for (const relPath of [...new Set(deletePaths)].sort()) await deleteStaticFile(site.code, relPath);
  if (site.staticMode === 'dynamic') {
    await invalidateCmsSiteCaches(site.id);
    return;
  }
  if (snapshot.build && current) {
    const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, snapshot.channelId)).limit(1);
    if (!channel || channel.path !== snapshot.channelPath) {
      throw new TaskCancelledError(`内容 #${snapshot.contentId} 栏目路径快照已过期`, { stale: true });
    }
    // 栏目在快照生成后被切为纯动态：跳过产物生成（旧产物已在上方 deletePaths 清理）
    if (!isChannelDynamic(site, channel)) {
      for (let pageNo = 1; pageNo <= snapshot.paths.length; pageNo++) {
        const rendered = await renderDetailPage(site, '', channel, snapshot.slug, pageNo);
        if (rendered.status !== 200) throw new Error(`内容 #${snapshot.contentId} 快照路径 ${snapshot.paths[pageNo - 1]} 渲染失败（${rendered.status}）`);
        await writeStaticFile(site.code, snapshot.paths[pageNo - 1], rendered.html);
      }
    }
  }
  // 一次校验全部待刷新栏目是否仍存在（快照生成后可能被删），替代逐个点查
  if (snapshot.refreshChannelIds.length > 0) {
    const existing = await db.select({ id: cmsChannels.id }).from(cmsChannels)
      .where(inArray(cmsChannels.id, [...snapshot.refreshChannelIds]));
    const existingIds = new Set(existing.map((row) => row.id));
    for (const channelId of snapshot.refreshChannelIds) {
      if (existingIds.has(channelId)) await refreshChannelStatic(channelId);
    }
  }
}

/** 路由层调用：后台不阻塞响应，失败仅记录日志 */
export function triggerContentStaticRefresh(contentId: number): void {
  void import('./cms-publishing.service').then(({ submitCmsContentPublishSideEffect }) => {
    submitCmsContentPublishSideEffect(contentId);
  }).catch((err) => logger.error(`[CMS] 内容 ${contentId} 发布任务提交失败`, err));
}

/**
 * 可视化搭建页面增量静态刷新：重写页面路径（isHome 同时重写首页）；停用/删除时移除文件。
 *
 * `removePath` 用于「slug/自定义路径变更」场景 —— 旧产物的路径已不在库里，必须由调用方
 * 显式带上，否则旧 URL 会残留一份可访问的孤儿页面（孤儿清扫只在整站重建时才跑）。
 */
export async function refreshCustomPageStatic(input: { siteId: number; slug: string; isHome: boolean; removed?: boolean; removePath?: string | null }): Promise<void> {
  const site = await resolveEffectiveCmsSiteRow(input.siteId).catch(() => null);
  if (!site) return;
  if (site.staticMode === 'dynamic') {
    await invalidateCmsSiteCaches(site.id);
    return;
  }
  const { getPublishedPageBySlug } = await import('./cms-pages.service');
  const pageRow = input.removed ? null : await getPublishedPageBySlug(site.id, input.slug);
  const previousPath = input.removePath?.trim() || null;
  const targetPath = pageRow ? customPagePath(pageRow) : (previousPath || `p/${input.slug}/`);
  // A rename carries both the old path and the current page. Remove the old
  // artifact first, then write the current page; otherwise retries could
  // clean the stale URL but accidentally skip regenerating the new one.
  if (previousPath && pageRow && previousPath !== targetPath) {
    await deleteStaticFile(site.code, previousPath);
  }
  const shouldWrite = !input.removed && !!pageRow && !pageRow.requiresDynamic;
  if (shouldWrite) {
    const result = await renderCustomPage(site, '', pageRow!);
    if (result.status === 200) await writeStaticFile(site.code, targetPath, result.html);
  } else {
    await deleteStaticFile(site.code, targetPath);
  }
  if (input.isHome) await refreshHomeStatic(site);
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  triggerCdnPurge(site, ['sitemap.xml', targetPath, ...(input.isHome ? [''] : [])]);
}

export function triggerCustomPageStaticRefresh(input: { siteId: number; slug: string; isHome: boolean; removed?: boolean; removePath?: string | null }): void {
  void import('./cms-publishing.service').then(({ submitCmsPagePublishSideEffect }) => {
    submitCmsPagePublishSideEffect(input);
  }).catch((err) => logger.error(`[CMS] 搭建页 ${input.slug} 发布任务提交失败`, err));
}

/** 发布中心栏目级重建：栏目全部分页 + 首页 + sitemap/RSS。 */
export async function refreshChannelStatic(channelId: number): Promise<{ pages: number }> {
  const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, channelId)).limit(1);
  if (!channel) throw new Error(`栏目不存在（id=${channelId}）`);
  const site = await resolveEffectiveCmsSiteRow(channel.siteId).catch(() => null);
  if (!site) throw new Error(`站点不存在（id=${channel.siteId}）`);
  await invalidateCmsSiteCaches(site.id);
  let pages = 0;
  pages += await regenerateChannelPages(site, channel);
  if (await refreshHomeStatic(site)) pages += 1;
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
  triggerCdnPurgeAll(site);
  return { pages };
}

// ─── 全量静态化（task-center handler 调用）───────────────────────────────────────
export interface FullBuildProgress {
  processed: number;
  total: number;
  note: string;
  checkpoint: CmsStaticBuildCheckpoint;
}

export interface CmsStaticBuildCheckpoint {
  phase: 'home' | 'channel' | 'content' | 'tag' | 'page' | 'meta';
  lastKey: string;
  lastId: number | null;
}

export async function buildSiteStatic(
  siteId: number,
  onProgress?: (p: FullBuildProgress) => Promise<boolean | void>,
  options?: { resumeAfterKey?: string | null },
): Promise<{ pages: number; pruned: number }> {
  const written = new Set<string>();
  return buildWriteCollector.run(written, () => buildSiteStaticInner(siteId, written, onProgress, options));
}

async function buildSiteStaticInner(
  siteId: number,
  written: Set<string>,
  onProgress?: (p: FullBuildProgress) => Promise<boolean | void>,
  options?: { resumeAfterKey?: string | null },
): Promise<{ pages: number; pruned: number }> {
  const site = await resolveEffectiveCmsSiteRow(siteId).catch(() => null);
  if (!site) throw new Error(`站点不存在（id=${siteId}）`);
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);

  const channels = await db.select().from(cmsChannels)
    .where(and(
      eq(cmsChannels.siteId, siteId),
      eq(cmsChannels.status, 'enabled'),
      effectiveChannelIds.size > 0 ? inArray(cmsChannels.id, [...effectiveChannelIds]) : sql`false`,
    ))
    .orderBy(asc(cmsChannels.id));
  // 构建计划只装载 URL 所需的窄列；正文只在逐篇数分页时按批取，全站 body 不再一次性进入内存
  const contents = await db.select({ id: cmsContents.id, slug: cmsContents.slug, staticPath: cmsContents.staticPath, publishedAt: cmsContents.publishedAt, createdAt: cmsContents.createdAt, channelId: cmsContents.channelId, externalLink: cmsContents.externalLink })
    .from(cmsContents)
    .where(and(
      eq(cmsContents.siteId, siteId),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
      effectiveChannelIds.size > 0 ? inArray(cmsContents.channelId, [...effectiveChannelIds]) : sql`false`,
    ))
    .orderBy(asc(cmsContents.id));

  const channelMap = new Map(channels.map((c) => [c.id, c]));
  const siteTags = await listSiteTags(siteId);
  const publicTagRows = effectiveChannelIds.size > 0
    ? await db.select({ tagId: cmsContentTags.tagId }).from(cmsContentTags)
      .innerJoin(cmsContents, eq(cmsContentTags.contentId, cmsContents.id))
      .where(and(
        eq(cmsContents.siteId, siteId),
        eq(cmsContents.status, 'published'),
        isNull(cmsContents.deletedAt),
        isNull(cmsContents.archivedAt),
        or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
        inArray(cmsContents.channelId, [...effectiveChannelIds]),
      ))
    : [];
  const publicTagIds = new Set(publicTagRows.map((row) => row.tagId));
  const activeTags = siteTags.filter((t) => publicTagIds.has(t.id)).sort((a, b) => a.id - b.id);
  const { listPublishedPages } = await import('./cms-pages.service');
  const publishedPages = await listPublishedPages(siteId);
  const customPages = publishedPages
    .filter((page) => !page.isHome && !page.requiresDynamic)
    .sort((a, b) => a.id - b.id);
  // 首页 + 栏目 + 内容 + 标签 + 搭建页；站点级：sitemap/rss/robots
  const total = 1 + channels.length + contents.length + activeTags.length + customPages.length + 3;
  let processed = 0;
  let pages = 0;
  const resumeAfterKey = options?.resumeAfterKey ?? null;
  const skipCompleted = (key: string): boolean => {
    if (!isCmsStaticTargetCompleted(key, resumeAfterKey)) return false;
    processed += 1;
    return true;
  };
  const report = async (
    note: string,
    checkpoint: CmsStaticBuildCheckpoint,
  ): Promise<boolean> => {
    processed += 1;
    const cancelled = await onProgress?.({ processed, total, note, checkpoint });
    return cancelled === true;
  };

  const homeKey = cmsStaticTargetKey('~site', 0, 0);
  if (!skipCompleted(homeKey)) {
    if (await refreshHomeStatic(site)) pages += 1;
    if (await report(`首页已生成`, {
      phase: 'home', lastKey: homeKey, lastId: null,
    })) return { pages, pruned: 0 };
  }

  for (const channel of channels) {
    const key = cmsStaticTargetKey('~site', 1, channel.id);
    if (skipCompleted(key)) continue;
    pages += await regenerateChannelPages(site, channel);
    if (await report(`栏目「${channel.name}」已生成`, {
      phase: 'channel', lastKey: key, lastId: channel.id,
    })) return { pages, pruned: 0 };
  }

  const BODY_PAGE_BATCH = 100;
  for (let offset = 0; offset < contents.length; offset += BODY_PAGE_BATCH) {
    const batch = contents.slice(offset, offset + BODY_PAGE_BATCH);
    // 只为需要生成详情页的内容取正文数分页；正文按批进入内存，处理完即释放
    const needBody = batch.filter((row) => {
      if (isCmsStaticTargetCompleted(cmsStaticTargetKey('~site', 2, row.id), resumeAfterKey)) return false;
      const channel = channelMap.get(row.channelId);
      return !!channel && !row.externalLink?.trim() && !isChannelDynamic(site, channel);
    });
    const bodyPagesById = new Map<number, number>();
    if (needBody.length > 0) {
      const bodyRows = await db.select({ id: cmsContents.id, body: cmsContents.body })
        .from(cmsContents).where(inArray(cmsContents.id, needBody.map((row) => row.id)));
      for (const bodyRow of bodyRows) bodyPagesById.set(bodyRow.id, splitBodyPages(bodyRow.body).length);
    }
    for (const row of batch) {
      const key = cmsStaticTargetKey('~site', 2, row.id);
      if (skipCompleted(key)) continue;
      const channel = channelMap.get(row.channelId);
      if (channel && !row.externalLink?.trim() && !isChannelDynamic(site, channel)) {
        const bodyPages = bodyPagesById.get(row.id) ?? 1;
        for (let p = 1; p <= bodyPages; p++) {
          const ok = await writeRenderedPath(site, contentUrl('', channel, row, p));
          if (ok) pages += 1;
        }
      }
      if (await report(`内容 ${row.id} 已生成`, {
        phase: 'content', lastKey: key, lastId: row.id,
      })) return { pages, pruned: 0 };
    }
  }

  // 标签聚合页（仅首屏分页；深分页访问时由 hybrid 模式按需回写）
  for (const tag of activeTags) {
    const key = cmsStaticTargetKey('~site', 3, tag.id);
    if (skipCompleted(key)) continue;
    const result = await renderTagPage(site, '', tag.slug, 1);
    if (result.status === 200) {
      await writeStaticFile(site.code, `tag/${tag.slug}/`, result.html);
      pages += 1;
    }
    if (await report(`标签「${tag.name}」已生成`, {
      phase: 'tag', lastKey: key, lastId: tag.id,
    })) return { pages, pruned: 0 };
  }

  // 可视化搭建页面 /p/{slug}/
  for (const page of customPages) {
    const key = cmsStaticTargetKey('~site', 4, page.id);
    if (skipCompleted(key)) continue;
    const result = await renderCustomPage(site, '', page);
    if (result.status === 200) {
      await writeStaticFile(site.code, customPagePath(page), result.html);
      pages += 1;
    }
    if (await report(`搭建页「${page.name}」已生成`, {
      phase: 'page', lastKey: key, lastId: page.id,
    })) return { pages, pruned: 0 };
  }

  const sitemapKey = cmsStaticTargetKey('~meta', 0, 1);
  if (!skipCompleted(sitemapKey)) {
    await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
    if (await report('sitemap.xml 已生成', { phase: 'meta', lastKey: sitemapKey, lastId: 1 })) return { pages, pruned: 0 };
  }
  const rssKey = cmsStaticTargetKey('~meta', 0, 2);
  if (!skipCompleted(rssKey)) {
    await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
    if (await report('rss.xml 已生成', { phase: 'meta', lastKey: rssKey, lastId: 2 })) return { pages, pruned: 0 };
  }
  const robotsKey = cmsStaticTargetKey('~meta', 0, 3);
  if (!skipCompleted(robotsKey)) {
    await writeStaticFile(site.code, 'robots.txt', buildRobotsTxt(site));
    if (await report('robots.txt 已生成', { phase: 'meta', lastKey: robotsKey, lastId: 3 })) return { pages, pruned: 0 };
  }
  triggerCdnPurgeAll(site);
  // 孤儿清扫：仅在「从头完整跑完」时执行。断点续跑的 written 集合只含续跑段，
  // 直接清扫会把前半程的有效产物当成孤儿删掉，故明确跳过。
  let pruned = 0;
  if (resumeAfterKey == null) {
    pruned = await pruneOrphanStaticFiles(site.code, written);
    if (pruned > 0) logger.info(`[CMS] 站点 ${site.code} 全量重建清理孤儿产物 ${pruned} 个`);
  }
  return { pages, pruned };
}
