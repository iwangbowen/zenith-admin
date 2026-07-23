import path from 'node:path';
import fs from 'node:fs/promises';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { db } from '../../db';
import { cmsSites, cmsChannels, cmsContents } from '../../db/schema';
import type { CmsSiteRow, CmsChannelRow } from '../../db/schema';
import logger from '../../lib/logger';
import { formatIso8601 } from '../../lib/datetime';
import { CMS_CHANNEL_SEGMENT_PREFIX, type CmsContentPublishSnapshot } from '@zenith/shared';
import { TaskCancelledError } from '../../lib/task-center';
import { getActivePublishChannels, type PublishChannelInfo } from './cms-publish-channels.service';
import {
  renderSitePath, renderHomePage, renderChannelPage, renderDetailPage, renderTagPage, renderCustomPage,
  channelUrl, contentUrl, tagUrl, customPageUrl, siteOrigin, listSiteTags, generateRssXml, countContentBodyPages,
} from './cms-render.service';
import { triggerCdnPurge, triggerCdnPurgeAll } from './cms-cdn.service';

// ─── 静态目录 ─────────────────────────────────────────────────────────────────
import {
  CMS_STATIC_ROOT, isStrictlyWithin, resolveStaticFile, siteStaticDir,
} from './cms-static-path';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { recordCmsPublishArtifact } from './cms-publish-artifact-tracker';
import { cmsStaticTargetKey, isCmsStaticTargetCompleted } from './cms-static-build-plan';
import { assertCmsStaticWriteFence } from './cms-site-publish-lock.service';
export {
  CMS_STATIC_ROOT, isStrictlyWithin, pathToStaticFile, resolveStaticFile, siteStaticDir,
} from './cms-static-path';

export async function ensureCmsStaticBuildAccess(siteId: number): Promise<CmsSiteRow> {
  const site = await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  return site;
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

/** 原子写入：先写临时文件再 rename，避免读到半个页面 */
export async function writeStaticFile(siteCode: string, relPath: string, html: string): Promise<void> {
  const abs = resolveStaticFile(siteCode, relPath);
  if (!abs) return;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, html, 'utf8');
    await assertCmsStaticWriteFence();
    await fs.rename(tmp, abs);
    await recordCmsPublishArtifact({ relPath, status: 'generated', content: html });
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
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
  try {
    try {
      await fs.lstat(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    await assertCmsStaticWriteFence();
    await fs.rm(abs, { force: true });
    await recordCmsPublishArtifact({ relPath, status: 'deleted' });
    return true;
  } catch (error) {
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

// ─── sitemap / robots ─────────────────────────────────────────────────────────
function xmlEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** 生成站点 sitemap.xml（首页 + 栏目首屏 + 已发布内容，上限 5 万条） */
export async function generateSitemapXml(site: CmsSiteRow): Promise<string> {
  const origin = siteOrigin(site) ?? '';
  const entries: { loc: string; lastmod: string | null; priority: string }[] = [];
  entries.push({ loc: `${origin}/`, lastmod: formatIso8601(new Date()), priority: '1.0' });

  const channels = await db.select().from(cmsChannels)
    .where(and(
      eq(cmsChannels.siteId, site.id),
      eq(cmsChannels.status, 'enabled'),
    ));
  const channelPathMap = new Map<number, string>();
  for (const ch of channels) {
    channelPathMap.set(ch.id, ch.path);
    if (ch.type === 'link') continue;
    entries.push({ loc: `${origin}${channelUrl('', ch.path)}`, lastmod: formatIso8601(ch.updatedAt), priority: '0.8' });
  }

  const contents = await db.select({
    id: cmsContents.id,
    slug: cmsContents.slug,
    channelId: cmsContents.channelId,
    publishedAt: cmsContents.publishedAt,
    externalLink: cmsContents.externalLink,
  })
    .from(cmsContents)
    .where(and(eq(cmsContents.siteId, site.id), eq(cmsContents.status, 'published'), isNull(cmsContents.deletedAt)))
    .limit(50000);
  for (const row of contents) {
    if (row.externalLink?.trim()) continue;
    const chPath = channelPathMap.get(row.channelId);
    if (!chPath) continue;
    entries.push({ loc: `${origin}${contentUrl('', chPath, row)}`, lastmod: formatIso8601(row.publishedAt), priority: '0.6' });
  }

  // 标签聚合页
  const tags = await listSiteTags(site.id);
  for (const tag of tags) {
    if (tag.contentCount <= 0) continue;
    entries.push({ loc: `${origin}${tagUrl('', tag.slug)}`, lastmod: null, priority: '0.4' });
  }

  // 可视化搭建页面
  const { listPublishedPages } = await import('./cms-pages.service');
  for (const page of await listPublishedPages(site.id)) {
    if (page.isHome) continue; // 首页接管已由 '/' 收录
    entries.push({ loc: `${origin}${customPageUrl('', page.slug)}`, lastmod: formatIso8601(page.updatedAt), priority: '0.7' });
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

/** 静态产物相对路径：非默认通道落在 __{code}/ 子树 */
function channelStaticPath(channel: PublishChannelInfo, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '');
  return channel.isDefault ? clean : `${CMS_CHANNEL_SEGMENT_PREFIX}${channel.code}/${clean}`;
}

async function writeRenderedPath(site: CmsSiteRow, relPath: string, channel: PublishChannelInfo): Promise<boolean> {
  const result = await renderSitePath(site, '', relPath, channel.code);
  if (result.status === 200) {
    await writeStaticFile(site.code, channelStaticPath(channel, relPath), result.html);
    return true;
  }

  if (result.status === 404) {
    await deleteStaticFile(site.code, channelStaticPath(channel, relPath));
  }
  return false;
}

async function refreshHomeStaticForChannel(
  site: CmsSiteRow,
  publishChannel: PublishChannelInfo,
): Promise<boolean> {
  const { getHomeTakeoverPage } = await import('./cms-pages.service');
  const takeover = await getHomeTakeoverPage(site.id);
  const staticPath = channelStaticPath(publishChannel, '');
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

/** 重新生成栏目的全部分页列表（超出的旧分页文件删除） */
async function regenerateChannelPages(site: CmsSiteRow, channel: CmsChannelRow, publishChannel: PublishChannelInfo): Promise<number> {
  if (channel.type === 'link') return 0;
  let generated = 0;
  const first = await renderChannelPage(site, '', channel, 1, publishChannel.code);
  if (first.status !== 200) return 0;
  await writeStaticFile(site.code, channelStaticPath(publishChannel, `${channel.path}/`), first.html);
  generated += 1;
  if (channel.type === 'page') return generated;

  const total = await db.$count(cmsContents, and(
    eq(cmsContents.siteId, site.id),
    eq(cmsContents.channelId, channel.id),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
  ));
  const totalPages = Math.min(Math.max(1, Math.ceil(total / channel.pageSize)), MAX_LIST_PAGES);
  for (let p = 2; p <= totalPages; p++) {
    const result = await renderChannelPage(site, '', channel, p, publishChannel.code);
    if (result.status === 200) {
      await writeStaticFile(site.code, channelStaticPath(publishChannel, `${channel.path}/index_${p}.html`), result.html);
      generated += 1;
    }
  }
  // 清掉超出当前页数的历史分页
  for (let p = totalPages + 1; p <= MAX_LIST_PAGES; p++) {
    await deleteStaticFile(site.code, channelStaticPath(publishChannel, `${channel.path}/index_${p}.html`));
  }
  return generated;
}

/**
 * 内容发布/更新/下线后的增量静态化：
 * 详情页 + 所属栏目全部分页 + 首页 + sitemap（按站点启用的发布通道逐通道生成）。staticMode=dynamic 的站点直接跳过。
 */
export async function refreshContentStatic(contentId: number): Promise<void> {
  const [content] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!content) return;
  const [site] = await db.select().from(cmsSites).where(and(
    eq(cmsSites.id, content.siteId),
  )).limit(1);
  if (!site || site.staticMode === 'dynamic') return;
  const [channel] = await db.select().from(cmsChannels).where(and(
    eq(cmsChannels.id, content.channelId),
  )).limit(1);
  if (!channel) return;

  const detailPath = contentUrl('', channel.path, content);
  const isVisible = content.status === 'published' && !content.deletedAt && !content.externalLink?.trim();
  const bodyPages = isVisible ? await countContentBodyPages(content) : 1;
  const purgePaths: string[] = ['sitemap.xml', 'rss.xml'];
  for (const publishChannel of await getActivePublishChannels(site.id)) {
    if (isVisible) {
      for (let p = 1; p <= bodyPages; p++) {
        const result = await renderDetailPage(site, '', channel, String(content.slug ?? content.id), publishChannel.code, p);
        if (result.status === 200) await writeStaticFile(site.code, channelStaticPath(publishChannel, contentUrl('', channel.path, content, p)), result.html);
      }
    } else {
      await deleteStaticFile(site.code, channelStaticPath(publishChannel, detailPath));
    }
    // 清理已收缩/下线的多余分页文件（best-effort，窗口 5 页）
    for (let p = Math.max(2, bodyPages + 1); p <= bodyPages + 5; p++) {
      await deleteStaticFile(site.code, channelStaticPath(publishChannel, contentUrl('', channel.path, content, p)));
    }

    await regenerateChannelPages(site, channel, publishChannel);
    await refreshHomeStaticForChannel(site, publishChannel);
    // CDN 刷新路径：详情页（含正文分页）+ 栏目列表页 + 首页
    for (let p = 1; p <= bodyPages; p++) {
      purgePaths.push(channelStaticPath(publishChannel, contentUrl('', channel.path, content, p)));
    }
    purgePaths.push(channelStaticPath(publishChannel, channelUrl('', channel.path)));
    purgePaths.push(channelStaticPath(publishChannel, ''));
  }
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
  triggerCdnPurge(site, purgePaths);
}

/** 按事务内冻结的路径/版本快照执行内容发布，不依赖已删除行推导旧路径。 */
export async function applyCmsContentPublishSnapshot(
  snapshot: CmsContentPublishSnapshot,
  deletePaths: readonly string[],
): Promise<void> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, snapshot.siteId)).limit(1);
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
  if (site.staticMode === 'dynamic') return;
  if (snapshot.build && current) {
    const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, snapshot.channelId)).limit(1);
    if (!channel || channel.path !== snapshot.channelPath) {
      throw new TaskCancelledError(`内容 #${snapshot.contentId} 栏目路径快照已过期`, { stale: true });
    }
    for (const target of snapshot.targets) {
      for (let page = 1; page <= target.paths.length; page++) {
        const rendered = await renderDetailPage(site, '', channel, snapshot.slug, target.publishChannelCode, page);
        if (rendered.status !== 200) throw new Error(`内容 #${snapshot.contentId} 快照路径 ${target.paths[page - 1]} 渲染失败（${rendered.status}）`);
        await writeStaticFile(site.code, target.paths[page - 1], rendered.html);
      }
    }
  }
  for (const channelId of snapshot.refreshChannelIds) {
    const [channel] = await db.select({ id: cmsChannels.id }).from(cmsChannels).where(eq(cmsChannels.id, channelId)).limit(1);
    if (channel) await refreshChannelStatic(channel.id);
  }
}

/** 路由层调用：后台不阻塞响应，失败仅记录日志 */
export function triggerContentStaticRefresh(contentId: number): void {
  void import('./cms-publishing.service').then(({ submitCmsContentPublishSideEffect }) => {
    submitCmsContentPublishSideEffect(contentId);
  }).catch((err) => logger.error(`[CMS] 内容 ${contentId} 发布任务提交失败`, err));
}

/** 可视化搭建页面增量静态刷新：重写 /p/{slug}/（isHome 同时重写首页）；停用/删除时移除文件 */
export async function refreshCustomPageStatic(input: { siteId: number; slug: string; isHome: boolean; removed?: boolean }): Promise<void> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, input.siteId)).limit(1);
  if (!site || site.staticMode === 'dynamic') return;
  const publishChannels = await getActivePublishChannels(site.id);
  if (input.removed) {
    for (const ch of publishChannels) await deleteStaticFile(site.code, channelStaticPath(ch, `p/${input.slug}/`));
  } else {
    const { getPublishedPageBySlug } = await import('./cms-pages.service');
    const pageRow = await getPublishedPageBySlug(site.id, input.slug);
    if (pageRow?.requiresDynamic) {
      for (const ch of publishChannels) await deleteStaticFile(site.code, channelStaticPath(ch, `p/${input.slug}/`));
    } else if (pageRow) {
      const result = await renderCustomPage(site, '', pageRow);
      if (result.status === 200) {
        for (const ch of publishChannels) await writeStaticFile(site.code, channelStaticPath(ch, `p/${input.slug}/`), result.html);
      }
    } else {
      for (const ch of publishChannels) await deleteStaticFile(site.code, channelStaticPath(ch, `p/${input.slug}/`));
    }
  }
  if (input.isHome) {
    for (const ch of publishChannels) await refreshHomeStaticForChannel(site, ch);
  }
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  triggerCdnPurge(site, [
    'sitemap.xml',
    ...publishChannels.flatMap((ch) => [
      channelStaticPath(ch, `p/${input.slug}/`),
      ...(input.isHome ? [channelStaticPath(ch, '')] : []),
    ]),
  ]);
}

export function triggerCustomPageStaticRefresh(input: { siteId: number; slug: string; isHome: boolean; removed?: boolean }): void {
  void import('./cms-publishing.service').then(({ submitCmsPagePublishSideEffect }) => {
    submitCmsPagePublishSideEffect(input);
  }).catch((err) => logger.error(`[CMS] 搭建页 ${input.slug} 发布任务提交失败`, err));
}

/** 发布中心栏目级重建：栏目全部分页 + 首页 + sitemap/RSS。 */
export async function refreshChannelStatic(channelId: number): Promise<{ pages: number }> {
  const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, channelId)).limit(1);
  if (!channel) throw new Error(`栏目不存在（id=${channelId}）`);
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, channel.siteId)).limit(1);
  if (!site) throw new Error(`站点不存在（id=${channel.siteId}）`);
  let pages = 0;
  for (const publishChannel of await getActivePublishChannels(site.id)) {
    pages += await regenerateChannelPages(site, channel, publishChannel);
    if (await refreshHomeStaticForChannel(site, publishChannel)) pages += 1;
  }
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
  publishChannelCode: string | null;
}

export async function buildSiteStatic(
  siteId: number,
  onProgress?: (p: FullBuildProgress) => Promise<boolean | void>,
  options?: { resumeAfterKey?: string | null },
): Promise<{ pages: number }> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!site) throw new Error(`站点不存在（id=${siteId}）`);

  const channels = await db.select().from(cmsChannels)
    .where(and(eq(cmsChannels.siteId, siteId), eq(cmsChannels.status, 'enabled')))
    .orderBy(asc(cmsChannels.id));
  const contents = await db.select({ id: cmsContents.id, slug: cmsContents.slug, channelId: cmsContents.channelId, externalLink: cmsContents.externalLink, body: cmsContents.body, extend: cmsContents.extend, mappingSourceId: cmsContents.mappingSourceId })
    .from(cmsContents)
    .where(and(eq(cmsContents.siteId, siteId), eq(cmsContents.status, 'published'), isNull(cmsContents.deletedAt)))
    .orderBy(asc(cmsContents.id));

  const channelMap = new Map(channels.map((c) => [c.id, c]));
  const siteTags = await listSiteTags(siteId);
  const activeTags = siteTags.filter((t) => t.contentCount > 0).sort((a, b) => a.id - b.id);
  const { listPublishedPages } = await import('./cms-pages.service');
  const publishedPages = await listPublishedPages(siteId);
  const customPages = publishedPages
    .filter((page) => !page.isHome && !page.requiresDynamic)
    .sort((a, b) => a.id - b.id);
  const publishChannels = [...await getActivePublishChannels(siteId)]
    .sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  // 每通道：首页 + 栏目 + 内容 + 标签 + 搭建页；站点级：sitemap/rss/robots
  const total = publishChannels.length * (1 + channels.length + contents.length + activeTags.length + customPages.length) + 3;
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

  for (const publishChannel of publishChannels) {
    const channelLabel = publishChannels.length > 1 ? `[${publishChannel.name}] ` : '';
    const homeKey = cmsStaticTargetKey(publishChannel.code, 0, 0);
    if (!skipCompleted(homeKey)) {
      if (await refreshHomeStaticForChannel(site, publishChannel)) pages += 1;
      if (await report(`${channelLabel}首页已生成`, {
        phase: 'home', lastKey: homeKey, lastId: null, publishChannelCode: publishChannel.code,
      })) return { pages };
    }

    for (const channel of channels) {
      const key = cmsStaticTargetKey(publishChannel.code, 1, channel.id);
      if (skipCompleted(key)) continue;
      pages += await regenerateChannelPages(site, channel, publishChannel);
      if (await report(`${channelLabel}栏目「${channel.name}」已生成`, {
        phase: 'channel', lastKey: key, lastId: channel.id, publishChannelCode: publishChannel.code,
      })) return { pages };
    }

    for (const row of contents) {
      const key = cmsStaticTargetKey(publishChannel.code, 2, row.id);
      if (skipCompleted(key)) continue;
      const channel = channelMap.get(row.channelId);
      if (channel && !row.externalLink?.trim()) {
        const bodyPages = await countContentBodyPages(row);
        for (let p = 1; p <= bodyPages; p++) {
          const ok = await writeRenderedPath(site, contentUrl('', channel.path, row, p), publishChannel);
          if (ok) pages += 1;
        }
      }
      if (await report(`${channelLabel}内容 ${row.id} 已生成`, {
        phase: 'content', lastKey: key, lastId: row.id, publishChannelCode: publishChannel.code,
      })) return { pages };
    }

    // 标签聚合页（仅首屏分页；深分页访问时由 hybrid 模式按需回写）
    for (const tag of activeTags) {
      const key = cmsStaticTargetKey(publishChannel.code, 3, tag.id);
      if (skipCompleted(key)) continue;
      const result = await renderTagPage(site, '', tag.slug, 1);
      if (result.status === 200) {
        await writeStaticFile(site.code, channelStaticPath(publishChannel, `tag/${tag.slug}/`), result.html);
        pages += 1;
      }
      if (await report(`${channelLabel}标签「${tag.name}」已生成`, {
        phase: 'tag', lastKey: key, lastId: tag.id, publishChannelCode: publishChannel.code,
      })) return { pages };
    }

    // 可视化搭建页面 /p/{slug}/
    for (const page of customPages) {
      const key = cmsStaticTargetKey(publishChannel.code, 4, page.id);
      if (skipCompleted(key)) continue;
      const result = await renderCustomPage(site, '', page);
      if (result.status === 200) {
        await writeStaticFile(site.code, channelStaticPath(publishChannel, `p/${page.slug}/`), result.html);
        pages += 1;
      }
      if (await report(`${channelLabel}搭建页「${page.name}」已生成`, {
        phase: 'page', lastKey: key, lastId: page.id, publishChannelCode: publishChannel.code,
      })) return { pages };
    }
  }

  const sitemapKey = cmsStaticTargetKey('~meta', 0, 1);
  if (!skipCompleted(sitemapKey)) {
    await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
    if (await report('sitemap.xml 已生成', { phase: 'meta', lastKey: sitemapKey, lastId: 1, publishChannelCode: null })) return { pages };
  }
  const rssKey = cmsStaticTargetKey('~meta', 0, 2);
  if (!skipCompleted(rssKey)) {
    await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
    if (await report('rss.xml 已生成', { phase: 'meta', lastKey: rssKey, lastId: 2, publishChannelCode: null })) return { pages };
  }
  const robotsKey = cmsStaticTargetKey('~meta', 0, 3);
  if (!skipCompleted(robotsKey)) {
    await writeStaticFile(site.code, 'robots.txt', buildRobotsTxt(site));
    if (await report('robots.txt 已生成', { phase: 'meta', lastKey: robotsKey, lastId: 3, publishChannelCode: null })) return { pages };
  }
  triggerCdnPurgeAll(site);
  return { pages };
}
