import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { cmsChannels } from '../../db/schema';
import type { CmsSiteRow, CmsChannelRow, CmsContentRow } from '../../db/schema';
import { formatNullableDateTime, formatIso8601 } from '../../lib/datetime';
import { getTheme, resolveListTemplate, resolveDetailTemplate } from '../../cms/themes/registry';
import type {
  CmsBaseContext, CmsNavItem, CmsSeo, CmsContentItem, CmsPagination, CmsBreadcrumb, CmsChannelInfo,
} from '../../cms/themes/types';
import { listCmsChannelTree } from './cms-channels.service';
import {
  listPublishedContents, listHomeContents, getPublishedContent, getAdjacentContents, listContentTags,
} from './cms-contents.service';
import { getFragmentMap } from './cms-fragments.service';
import { listEnabledFriendLinks } from './cms-friend-links.service';
import { searchCmsContents, stripHtml } from './cms-search.service';
import type { CmsChannel } from '@zenith/shared';

// ─── URL 规则（站点内相对路径，静态文件名与之一一对应）──────────────────────────
export function channelUrl(baseUrl: string, path: string, page = 1): string {
  return page <= 1 ? `${baseUrl}/${path}/` : `${baseUrl}/${path}/index_${page}.html`;
}

export function contentUrl(baseUrl: string, channelPath: string, content: Pick<CmsContentRow, 'id' | 'slug'>): string {
  return `${baseUrl}/${channelPath}/${content.slug ?? content.id}.html`;
}

/** 站点绝对地址前缀（canonical / sitemap 用）；未绑定域名返回 null */
export function siteOrigin(site: CmsSiteRow): string | null {
  if (!site.domain) return null;
  const protocol = (site.settings as Record<string, unknown> | null)?.protocol === 'http' ? 'http' : 'https';
  return `${protocol}://${site.domain}`;
}

// ─── 渲染结果 ─────────────────────────────────────────────────────────────────
export type RenderResult =
  | { status: 200; html: string; kind: 'home' | 'list' | 'page' | 'detail' | 'search'; contentId?: number }
  | { status: 404; html: string; kind: 'notFound' }
  | { status: 302; location: string };

function renderDoc<P extends object>(component: ComponentType<P>, props: P): string {
  return '<!DOCTYPE html>' + renderToStaticMarkup(createElement(component, props));
}

// ─── 上下文组装 ───────────────────────────────────────────────────────────────
function navFromTree(tree: CmsChannel[], baseUrl: string): CmsNavItem[] {
  const walk = (nodes: CmsChannel[]): CmsNavItem[] => nodes
    .filter((n) => n.visible)
    .map((n) => ({
      id: n.id,
      name: n.name,
      url: n.type === 'link' ? (n.linkUrl ?? '#') : channelUrl(baseUrl, n.path),
      target: n.type === 'link' ? '_blank' as const : '_self' as const,
      ...(n.children && n.children.length > 0 ? { children: walk(n.children) } : {}),
    }));
  return walk(tree);
}

function mergeSeo(site: CmsSiteRow, overrides: Partial<CmsSeo> & { pathForCanonical?: string }): CmsSeo {
  const origin = siteOrigin(site);
  const siteTitle = site.title?.trim() || site.name;
  const title = overrides.title ?? siteTitle;
  const description = overrides.description ?? site.description ?? '';
  return {
    title,
    keywords: overrides.keywords ?? site.keywords ?? '',
    description,
    canonical: origin && overrides.pathForCanonical !== undefined ? `${origin}${overrides.pathForCanonical}` : null,
    ogTitle: overrides.ogTitle ?? title,
    ogDescription: overrides.ogDescription ?? description,
    ogImage: overrides.ogImage ?? site.logo ?? null,
    jsonLd: overrides.jsonLd ?? null,
  };
}

async function buildBaseContext(site: CmsSiteRow, baseUrl: string, seo: CmsSeo): Promise<CmsBaseContext> {
  const [tree, fragments, friendLinks] = await Promise.all([
    listCmsChannelTree({ siteId: site.id, status: 'enabled' }),
    getFragmentMap(site.id),
    listEnabledFriendLinks(site.id),
  ]);
  return {
    site: {
      id: site.id,
      code: site.code,
      name: site.name,
      title: site.title ?? null,
      keywords: site.keywords ?? null,
      description: site.description ?? null,
      logo: site.logo ?? null,
      favicon: site.favicon ?? null,
      icp: site.icp ?? null,
      copyright: site.copyright ?? null,
      theme: site.theme,
      settings: site.settings ?? {},
    },
    baseUrl,
    nav: navFromTree(tree, baseUrl),
    fragments,
    friendLinks: friendLinks.map((l) => ({ name: l.name, url: l.url, logo: l.logo })),
    seo,
    searchUrl: `${baseUrl}/search`,
  };
}

function toContentItem(row: CmsContentRow, baseUrl: string, channelPath: string): CmsContentItem {
  return {
    id: row.id,
    title: row.title,
    url: row.externalLink?.trim() ? row.externalLink : contentUrl(baseUrl, channelPath, row),
    summary: row.summary?.trim() ? row.summary : (row.body ? stripHtml(row.body).slice(0, 120) : null),
    coverImage: row.coverImage ?? null,
    author: row.author ?? null,
    source: row.source ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    viewCount: row.viewCount,
    isTop: row.isTop,
    isRecommend: row.isRecommend,
    isHot: row.isHot,
  };
}

function buildPagination(baseUrl: string, channelPath: string, page: number, pageSize: number, total: number): CmsPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const window = 5;
  const start = Math.max(1, Math.min(page - Math.floor(window / 2), totalPages - window + 1));
  const end = Math.min(totalPages, start + window - 1);
  const pages = [];
  for (let p = start; p <= end; p++) {
    pages.push({ page: p, url: channelUrl(baseUrl, channelPath, p), current: p === page });
  }
  return {
    page,
    pageSize,
    total,
    totalPages,
    prevUrl: page > 1 ? channelUrl(baseUrl, channelPath, page - 1) : null,
    nextUrl: page < totalPages ? channelUrl(baseUrl, channelPath, page + 1) : null,
    pages,
  };
}

async function buildBreadcrumbs(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow): Promise<CmsBreadcrumb[]> {
  const crumbs: CmsBreadcrumb[] = [{ name: '首页', url: `${baseUrl}/` }];
  const chain: CmsChannelRow[] = [];
  let cursor: CmsChannelRow | null = channel;
  while (cursor) {
    chain.unshift(cursor);
    if (cursor.parentId === 0) break;
    const [parent] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, cursor.parentId)).limit(1);
    cursor = parent ?? null;
  }
  for (const ch of chain) {
    crumbs.push({ name: ch.name, url: channelUrl(baseUrl, ch.path) });
  }
  return crumbs;
}

function toChannelInfo(channel: CmsChannelRow, baseUrl: string): CmsChannelInfo {
  return {
    id: channel.id,
    name: channel.name,
    url: channelUrl(baseUrl, channel.path),
    description: channel.seoDescription ?? null,
    image: channel.image ?? null,
  };
}

export async function findChannelByPath(siteId: number, path: string): Promise<CmsChannelRow | null> {
  const [row] = await db.select().from(cmsChannels)
    .where(and(eq(cmsChannels.siteId, siteId), eq(cmsChannels.path, path), eq(cmsChannels.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

// ─── 各页面渲染 ───────────────────────────────────────────────────────────────
export async function renderHomePage(site: CmsSiteRow, baseUrl: string): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const seo = mergeSeo(site, { pathForCanonical: '/' });
  const [base, home] = await Promise.all([
    buildBaseContext(site, baseUrl, seo),
    listHomeContents(site.id),
  ]);
  const channelPathMap = await loadChannelPathMap(site.id);
  const toItem = (row: CmsContentRow) => toContentItem(row, baseUrl, channelPathMap.get(row.channelId) ?? '');
  const html = renderDoc(theme.templates.index, {
    ...base,
    latest: home.latest.map(toItem),
    recommended: home.recommended.map(toItem),
    hot: home.hot.map(toItem),
  });
  return { status: 200, html, kind: 'home' };
}

async function loadChannelPathMap(siteId: number): Promise<Map<number, string>> {
  const rows = await db.select({ id: cmsChannels.id, path: cmsChannels.path }).from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  return new Map(rows.map((r) => [r.id, r.path]));
}

export async function renderChannelPage(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow, page = 1): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  if (channel.type === 'link') {
    return { status: 302, location: channel.linkUrl ?? `${baseUrl}/` };
  }
  const seo = mergeSeo(site, {
    title: channel.seoTitle ?? `${channel.name} - ${site.title?.trim() || site.name}`,
    keywords: channel.seoKeywords ?? undefined,
    description: channel.seoDescription ?? undefined,
    pathForCanonical: channelUrl('', channel.path, page),
  });
  const base = await buildBaseContext(site, baseUrl, seo);
  const breadcrumbs = await buildBreadcrumbs(site, baseUrl, channel);

  if (channel.type === 'page') {
    const html = renderDoc(theme.templates.page, {
      ...base,
      channel: toChannelInfo(channel, baseUrl),
      breadcrumbs,
      contentHtml: channel.pageContent ?? '',
    });
    return { status: 200, html, kind: 'page' };
  }

  const { total, rows } = await listPublishedContents(site.id, channel.id, page, channel.pageSize);
  if (page > 1 && rows.length === 0) return renderNotFound(site, baseUrl, `/${channel.path}/index_${page}.html`);
  const html = renderDoc(resolveListTemplate(theme, channel.listTemplate), {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    items: rows.map((r) => toContentItem(r, baseUrl, channel.path)),
    pagination: buildPagination(baseUrl, channel.path, page, channel.pageSize, total),
  });
  return { status: 200, html, kind: 'list' };
}

export async function renderDetailPage(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow, idOrSlug: string): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const row = await getPublishedContent(site.id, channel.id, idOrSlug);
  if (!row) return renderNotFound(site, baseUrl, `/${channel.path}/${idOrSlug}.html`);
  if (row.externalLink?.trim()) return { status: 302, location: row.externalLink };

  const canonicalPath = contentUrl('', channel.path, row);
  const origin = siteOrigin(site);
  const seo = mergeSeo(site, {
    title: row.seoTitle ?? `${row.title} - ${site.title?.trim() || site.name}`,
    keywords: row.seoKeywords ?? undefined,
    description: row.seoDescription ?? row.summary ?? undefined,
    ogTitle: row.title,
    ogImage: row.coverImage ?? undefined,
    pathForCanonical: canonicalPath,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: row.title,
      description: row.seoDescription ?? row.summary ?? undefined,
      image: row.coverImage ?? undefined,
      author: row.author ? { '@type': 'Person', name: row.author } : undefined,
      datePublished: formatIso8601(row.publishedAt) ?? undefined,
      mainEntityOfPage: origin ? `${origin}${canonicalPath}` : undefined,
    },
  });
  const [base, breadcrumbs, adjacent, tags] = await Promise.all([
    buildBaseContext(site, baseUrl, seo),
    buildBreadcrumbs(site, baseUrl, channel),
    getAdjacentContents(row),
    listContentTags(row.id),
  ]);
  const html = renderDoc(resolveDetailTemplate(theme, channel.detailTemplate), {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    content: {
      ...toContentItem(row, baseUrl, channel.path),
      body: row.body ?? '',
      extend: row.extend ?? {},
      tags: tags.map((t) => ({ name: t.name, slug: t.slug })),
      prev: adjacent.prev ? { title: adjacent.prev.title, url: contentUrl(baseUrl, channel.path, adjacent.prev) } : null,
      next: adjacent.next ? { title: adjacent.next.title, url: contentUrl(baseUrl, channel.path, adjacent.next) } : null,
    },
  });
  return { status: 200, html, kind: 'detail', contentId: row.id };
}

export async function renderSearchPage(site: CmsSiteRow, baseUrl: string, keyword: string, page = 1): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const pageSize = 10;
  const seo = mergeSeo(site, { title: keyword ? `搜索：${keyword} - ${site.name}` : `搜索 - ${site.name}` });
  const base = await buildBaseContext(site, baseUrl, seo);
  const result = keyword
    ? await searchCmsContents({ siteId: site.id, keyword, page, pageSize })
    : { list: [], total: 0, page, pageSize, tokens: [] };
  const searchPageUrl = (p: number) => `${baseUrl}/search?q=${encodeURIComponent(keyword)}&page=${p}`;
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const pages = [];
  const start = Math.max(1, page - 2);
  for (let p = start; p <= Math.min(totalPages, start + 4); p++) {
    pages.push({ page: p, url: searchPageUrl(p), current: p === page });
  }
  const html = renderDoc(theme.templates.search, {
    ...base,
    keyword,
    results: result.list,
    pagination: {
      page, pageSize, total: result.total, totalPages,
      prevUrl: page > 1 ? searchPageUrl(page - 1) : null,
      nextUrl: page < totalPages ? searchPageUrl(page + 1) : null,
      pages,
    },
  });
  return { status: 200, html, kind: 'search' };
}

export async function renderNotFound(site: CmsSiteRow, baseUrl: string, path: string): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const seo = mergeSeo(site, { title: `页面不存在 - ${site.name}` });
  const base = await buildBaseContext(site, baseUrl, seo);
  const html = renderDoc(theme.templates.notFound, { ...base, path });
  return { status: 404, html, kind: 'notFound' };
}

// ─── URL 解析：站内相对路径 → 渲染 ───────────────────────────────────────────────
/**
 * 解析并渲染站内路径（不含 search，search 由前台路由单独处理查询参数）。
 * 约定：'' 首页；'{path}/' 栏目页1；'{path}/index_{n}.html' 栏目页n；'{path}/{idOrSlug}.html' 详情。
 */
export async function renderSitePath(site: CmsSiteRow, baseUrl: string, rawPath: string): Promise<RenderResult> {
  const cleaned = rawPath.replace(/^\/+|\/+$/g, '');
  if (cleaned === '' || cleaned === 'index.html') {
    return renderHomePage(site, baseUrl);
  }

  if (cleaned.endsWith('.html')) {
    const segments = cleaned.split('/');
    const file = segments.pop()!;
    const dir = segments.join('/');
    const pageMatch = /^index_(\d+)\.html$/.exec(file);
    if (pageMatch) {
      if (!dir) return renderNotFound(site, baseUrl, `/${cleaned}`);
      const channel = await findChannelByPath(site.id, dir);
      if (!channel) return renderNotFound(site, baseUrl, `/${cleaned}`);
      return renderChannelPage(site, baseUrl, channel, Number(pageMatch[1]));
    }
    if (!dir) return renderNotFound(site, baseUrl, `/${cleaned}`);
    const channel = await findChannelByPath(site.id, dir);
    if (!channel) return renderNotFound(site, baseUrl, `/${cleaned}`);
    return renderDetailPage(site, baseUrl, channel, file.slice(0, -'.html'.length));
  }

  const channel = await findChannelByPath(site.id, cleaned);
  if (!channel) return renderNotFound(site, baseUrl, `/${cleaned}`);
  return renderChannelPage(site, baseUrl, channel, 1);
}
