import path from 'node:path';
import fs from 'node:fs/promises';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { cmsSites, cmsChannels, cmsContents } from '../../db/schema';
import type { CmsSiteRow, CmsChannelRow } from '../../db/schema';
import logger from '../../lib/logger';
import { formatIso8601 } from '../../lib/datetime';
import { CMS_H5_PATH_SEGMENT } from '@zenith/shared';
import type { CmsDeviceChannel } from '@zenith/shared';
import { siteH5Config } from './cms-sites.service';
import {
  renderSitePath, renderHomePage, renderChannelPage, renderDetailPage, renderTagPage, renderCustomPage,
  channelUrl, contentUrl, tagUrl, customPageUrl, siteOrigin, listSiteTags, generateRssXml,
} from './cms-render.service';

// ─── 静态目录 ─────────────────────────────────────────────────────────────────
const STATIC_ROOT = process.env.CMS_STATIC_ROOT?.trim()
  ? path.resolve(process.env.CMS_STATIC_ROOT.trim())
  : path.resolve(process.cwd(), 'storage/cms-static');

export function siteStaticDir(siteCode: string): string {
  return path.join(STATIC_ROOT, siteCode);
}

/** 站内相对路径 → 静态文件相对路径（'' → index.html；'a/b/' → a/b/index.html） */
export function pathToStaticFile(relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, '');
  if (cleaned === '' || cleaned === '/') return 'index.html';
  if (cleaned.endsWith('/')) return `${cleaned}index.html`;
  return cleaned;
}

/** 解析并校验静态文件绝对路径（防目录穿越） */
export function resolveStaticFile(siteCode: string, relPath: string): string | null {
  const dir = siteStaticDir(siteCode);
  const abs = path.resolve(dir, pathToStaticFile(relPath));
  if (!abs.startsWith(dir + path.sep) && abs !== dir) return null;
  return abs;
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
  await fs.writeFile(tmp, html, 'utf8');
  await fs.rename(tmp, abs);
}

export async function deleteStaticFile(siteCode: string, relPath: string): Promise<void> {
  const abs = resolveStaticFile(siteCode, relPath);
  if (!abs) return;
  await fs.rm(abs, { force: true });
}

/** 清空站点静态目录（全量重建前调用） */
export async function clearSiteStatic(siteCode: string): Promise<void> {
  await fs.rm(siteStaticDir(siteCode), { recursive: true, force: true });
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
    .where(and(eq(cmsChannels.siteId, site.id), eq(cmsChannels.status, 'enabled')));
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

/** 站点启用的发布通道（H5 开启后静态产物双通道生成） */
function siteDevices(site: CmsSiteRow): CmsDeviceChannel[] {
  return siteH5Config(site).enabled ? ['pc', 'h5'] : ['pc'];
}

/** 静态产物相对路径：H5 通道落在 __h5/ 子树 */
function deviceStaticPath(device: CmsDeviceChannel, relPath: string): string {
  return device === 'h5' ? `${CMS_H5_PATH_SEGMENT}/${relPath}` : relPath;
}

async function writeRenderedPath(site: CmsSiteRow, relPath: string, device: CmsDeviceChannel): Promise<boolean> {
  const result = await renderSitePath(site, '', relPath, device);
  if (result.status === 200) {
    await writeStaticFile(site.code, deviceStaticPath(device, relPath), result.html);
    return true;
  }
  if (result.status === 404) {
    await deleteStaticFile(site.code, deviceStaticPath(device, relPath));
  }
  return false;
}

/** 重新生成栏目的全部分页列表（超出的旧分页文件删除） */
async function regenerateChannelPages(site: CmsSiteRow, channel: CmsChannelRow, device: CmsDeviceChannel): Promise<number> {
  if (channel.type === 'link') return 0;
  let generated = 0;
  const first = await renderChannelPage(site, '', channel, 1, device);
  if (first.status !== 200) return 0;
  await writeStaticFile(site.code, deviceStaticPath(device, `${channel.path}/`), first.html);
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
    const result = await renderChannelPage(site, '', channel, p, device);
    if (result.status === 200) {
      await writeStaticFile(site.code, deviceStaticPath(device, `${channel.path}/index_${p}.html`), result.html);
      generated += 1;
    }
  }
  // 清掉超出当前页数的历史分页
  for (let p = totalPages + 1; p <= MAX_LIST_PAGES; p++) {
    await deleteStaticFile(site.code, deviceStaticPath(device, `${channel.path}/index_${p}.html`));
  }
  return generated;
}

/**
 * 内容发布/更新/下线后的增量静态化：
 * 详情页 + 所属栏目全部分页 + 首页 + sitemap（H5 通道开启时双通道生成）。staticMode=dynamic 的站点直接跳过。
 */
export async function refreshContentStatic(contentId: number): Promise<void> {
  const [content] = await db.select().from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!content) return;
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, content.siteId)).limit(1);
  if (!site || site.staticMode === 'dynamic') return;
  const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, content.channelId)).limit(1);
  if (!channel) return;

  const detailPath = contentUrl('', channel.path, content);
  const isVisible = content.status === 'published' && !content.deletedAt && !content.externalLink?.trim();
  for (const device of siteDevices(site)) {
    if (isVisible) {
      const result = await renderDetailPage(site, '', channel, String(content.slug ?? content.id), device);
      if (result.status === 200) await writeStaticFile(site.code, deviceStaticPath(device, detailPath), result.html);
    } else {
      await deleteStaticFile(site.code, deviceStaticPath(device, detailPath));
    }

    await regenerateChannelPages(site, channel, device);
    const home = await renderHomePage(site, '');
    if (home.status === 200) await writeStaticFile(site.code, deviceStaticPath(device, ''), home.html);
  }
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
}

/** 路由层调用：后台不阻塞响应，失败仅记录日志 */
export function triggerContentStaticRefresh(contentId: number): void {
  void refreshContentStatic(contentId).catch((err) => {
    logger.error(`[CMS] 内容 ${contentId} 增量静态化失败`, err);
  });
}

/** 可视化搭建页面增量静态刷新：重写 /p/{slug}/（isHome 同时重写首页）；停用/删除时移除文件 */
export async function refreshCustomPageStatic(input: { siteId: number; slug: string; isHome: boolean; removed?: boolean }): Promise<void> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, input.siteId)).limit(1);
  if (!site || site.staticMode === 'dynamic') return;
  const devices = siteDevices(site);
  if (input.removed) {
    for (const device of devices) await deleteStaticFile(site.code, deviceStaticPath(device, `p/${input.slug}/`));
  } else {
    const { getPublishedPageBySlug } = await import('./cms-pages.service');
    const pageRow = await getPublishedPageBySlug(site.id, input.slug);
    if (pageRow) {
      const result = await renderCustomPage(site, '', pageRow);
      if (result.status === 200) {
        for (const device of devices) await writeStaticFile(site.code, deviceStaticPath(device, `p/${input.slug}/`), result.html);
      }
    } else {
      for (const device of devices) await deleteStaticFile(site.code, deviceStaticPath(device, `p/${input.slug}/`));
    }
  }
  if (input.isHome) {
    const home = await renderHomePage(site, '');
    if (home.status === 200) {
      for (const device of devices) await writeStaticFile(site.code, deviceStaticPath(device, ''), home.html);
    }
  }
  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
}

export function triggerCustomPageStaticRefresh(input: { siteId: number; slug: string; isHome: boolean; removed?: boolean }): void {
  void refreshCustomPageStatic(input).catch((err) => {
    logger.error(`[CMS] 搭建页 ${input.slug} 增量静态化失败`, err);
  });
}

/** 碎片/友链/栏目等全局要素变化后触发整站重建提示（P1 由管理员在静态化管理页手动全量生成） */

// ─── 全量静态化（task-center handler 调用）───────────────────────────────────────
export interface FullBuildProgress {
  processed: number;
  total: number;
  note: string;
}

export async function buildSiteStatic(
  siteId: number,
  onProgress?: (p: FullBuildProgress) => Promise<boolean | void>,
): Promise<{ pages: number }> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!site) throw new Error(`站点不存在（id=${siteId}）`);

  const channels = await db.select().from(cmsChannels)
    .where(and(eq(cmsChannels.siteId, siteId), eq(cmsChannels.status, 'enabled')));
  const contents = await db.select({ id: cmsContents.id, slug: cmsContents.slug, channelId: cmsContents.channelId, externalLink: cmsContents.externalLink })
    .from(cmsContents)
    .where(and(eq(cmsContents.siteId, siteId), eq(cmsContents.status, 'published'), isNull(cmsContents.deletedAt)));

  const channelMap = new Map(channels.map((c) => [c.id, c]));
  const siteTags = await listSiteTags(siteId);
  const activeTags = siteTags.filter((t) => t.contentCount > 0);
  const { listPublishedPages } = await import('./cms-pages.service');
  const customPages = (await listPublishedPages(siteId)).filter((p) => !p.isHome);
  const devices = siteDevices(site);
  // 每通道：首页 + 栏目 + 内容 + 标签 + 搭建页；站点级：sitemap/rss/robots
  const total = devices.length * (1 + channels.length + contents.length + activeTags.length + customPages.length) + 3;
  let processed = 0;
  let pages = 0;

  const report = async (note: string): Promise<boolean> => {
    processed += 1;
    const cancelled = await onProgress?.({ processed, total, note });
    return cancelled === true;
  };

  for (const device of devices) {
    const deviceLabel = devices.length > 1 ? `[${device.toUpperCase()}] ` : '';
    const home = await renderHomePage(site, '');
    if (home.status === 200) {
      await writeStaticFile(site.code, deviceStaticPath(device, ''), home.html);
      pages += 1;
    }
    if (await report(`${deviceLabel}首页已生成`)) return { pages };

    for (const channel of channels) {
      pages += await regenerateChannelPages(site, channel, device);
      if (await report(`${deviceLabel}栏目「${channel.name}」已生成`)) return { pages };
    }

    for (const row of contents) {
      const channel = channelMap.get(row.channelId);
      if (channel && !row.externalLink?.trim()) {
        const ok = await writeRenderedPath(site, contentUrl('', channel.path, row), device);
        if (ok) pages += 1;
      }
      if (await report(`${deviceLabel}内容 ${row.id} 已生成`)) return { pages };
    }

    // 标签聚合页（仅首屏分页；深分页访问时由 hybrid 模式按需回写）
    for (const tag of activeTags) {
      const result = await renderTagPage(site, '', tag.slug, 1);
      if (result.status === 200) {
        await writeStaticFile(site.code, deviceStaticPath(device, `tag/${tag.slug}/`), result.html);
        pages += 1;
      }
      if (await report(`${deviceLabel}标签「${tag.name}」已生成`)) return { pages };
    }

    // 可视化搭建页面 /p/{slug}/
    for (const page of customPages) {
      const result = await renderCustomPage(site, '', page);
      if (result.status === 200) {
        await writeStaticFile(site.code, deviceStaticPath(device, `p/${page.slug}/`), result.html);
        pages += 1;
      }
      if (await report(`${deviceLabel}搭建页「${page.name}」已生成`)) return { pages };
    }
  }

  await writeStaticFile(site.code, 'sitemap.xml', await generateSitemapXml(site));
  await report('sitemap.xml 已生成');
  await writeStaticFile(site.code, 'rss.xml', await generateRssXml(site));
  await report('rss.xml 已生成');
  await writeStaticFile(site.code, 'robots.txt', buildRobotsTxt(site));
  await report('robots.txt 已生成');
  return { pages };
}
