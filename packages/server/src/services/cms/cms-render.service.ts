import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { cmsChannels, cmsTags, cmsContents, cmsModels, cmsSites } from '../../db/schema';
import type { CmsSiteRow, CmsChannelRow, CmsContentRow, CmsTagRow } from '../../db/schema';
import { formatNullableDateTime, formatIso8601 } from '../../lib/datetime';
import { getTheme, resolveListTemplate, resolveDetailTemplate, resolveCustomPageTemplate, resolveSurveyTemplate, resolveThemeConfig, isTemplateRegistered } from '../../cms/themes/registry';
import { renderBlocksHtml } from '../../cms/themes/blocks';
import type {
  CmsBaseContext, CmsNavItem, CmsSeo, CmsContentItem, CmsPagination, CmsBreadcrumb, CmsChannelInfo,
} from '../../cms/themes/types';
import { listCmsChannelTree } from './cms-channels.service';
import {
  listPublishedContents, listHomeContents, getPublishedContent, getAdjacentContents, listContentTags,
  listPublishedContentsByTag, listRelatedContents, resolveContentBodyExtend,
} from './cms-contents.service';
import { getFragmentMap } from './cms-fragments.service';
import { listEnabledFriendLinks } from './cms-friend-links.service';
import { searchCmsContents, stripHtml } from './cms-search.service';
import { getEnabledLinkWords, applyLinkWords } from './cms-link-words.service';
import { applyPollMarkers } from './cms-polls.service';
import { isCaptchaEnabled } from './cms-captcha.service';
import { resolveCmsFormCaptcha } from './cms-form-captcha.service';
import { listApprovedComments } from './cms-comments.service';
import { getActiveAds } from './cms-ads.service';
import { getCmsFormByCode } from './cms-forms.service';
import type { CmsChannel, CmsDeviceChannel, CmsFormField, CmsSiteTemplateDefaults } from '@zenith/shared';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared';

// ─── URL 规则（站点内相对路径，静态文件名与之一一对应）──────────────────────────
export function channelUrl(baseUrl: string, path: string, page = 1): string {
  return page <= 1 ? `${baseUrl}/${path}/` : `${baseUrl}/${path}/index_${page}.html`;
}

export function tagUrl(baseUrl: string, slug: string, page = 1): string {
  return page <= 1 ? `${baseUrl}/tag/${slug}/` : `${baseUrl}/tag/${slug}/index_${page}.html`;
}

export function contentUrl(baseUrl: string, channelPath: string, content: Pick<CmsContentRow, 'id' | 'slug'>, bodyPage = 1): string {
  const base = content.slug ?? content.id;
  return bodyPage <= 1
    ? `${baseUrl}/${channelPath}/${base}.html`
    : `${baseUrl}/${channelPath}/${base}_${bodyPage}.html`;
}

/** 正文分页拆分：编辑器插入 <p>[分页]</p>（兼容 <!-- pagebreak --> 与 <hr data-page-break>） */
const PAGE_BREAK_RE = /<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*\[分页\](?:\s|&nbsp;|<br\s*\/?>)*<\/p>|<!--\s*pagebreak\s*-->|<hr[^>]*data-page-break[^>]*\/?>/gi;

export function splitBodyPages(body: string | null | undefined): string[] {
  if (!body) return [''];
  const parts = body.split(PAGE_BREAK_RE).map((p) => p.trim()).filter((p) => p !== '');
  return parts.length > 0 ? parts : [body];
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

// ─── 模板解析链（发布通道感知）───────────────────────────────────────────────────
/** 站点 settings.defaultTemplates 按发布通道取默认模板配置 */
function siteTemplateDefaults(site: CmsSiteRow, device: CmsDeviceChannel): CmsSiteTemplateDefaults {
  const settings = site.settings as Record<string, unknown> | null;
  const all = settings?.defaultTemplates as Record<string, CmsSiteTemplateDefaults | undefined> | undefined;
  return all?.[device] ?? {};
}

/** 栏目 settings.templates 按发布通道取栏目级模板覆盖（结构与站点默认一致） */
function channelTemplateOverrides(channel: CmsChannelRow, device: CmsDeviceChannel): CmsSiteTemplateDefaults {
  const settings = channel.settings as Record<string, unknown> | null;
  const all = settings?.templates as Record<string, CmsSiteTemplateDefaults | undefined> | undefined;
  return all?.[device] ?? {};
}

// 模型 id → code 内存缓存（detailByModel 解析用；模型极少变动）
let modelCodeCache: { map: Map<number, string>; loadedAt: number } | null = null;
const MODEL_CACHE_TTL_MS = 30_000;

async function getModelCode(modelId: number): Promise<string | null> {
  if (!modelCodeCache || Date.now() - modelCodeCache.loadedAt > MODEL_CACHE_TTL_MS) {
    const rows = await db.select({ id: cmsModels.id, code: cmsModels.code }).from(cmsModels);
    modelCodeCache = { map: new Map(rows.map((r) => [r.id, r.code])), loadedAt: Date.now() };
  }
  return modelCodeCache.map.get(modelId) ?? null;
}

/** 列表模板：试穿参数（预览态） → 栏目[通道] → 栏目通用 → 站点默认[通道] → 主题默认 */
function resolveListComponent(site: CmsSiteRow, device: CmsDeviceChannel, channel: CmsChannelRow, templateOverride?: string | null) {
  const theme = getTheme(site.theme);
  const tryOn = templateOverride && isTemplateRegistered(site.theme, 'list', templateOverride) ? templateOverride : null;
  const name = tryOn
    || channelTemplateOverrides(channel, device).list
    || channel.listTemplate
    || siteTemplateDefaults(site, device).list
    || null;
  return resolveListTemplate(theme, name);
}

/**
 * 详情模板：试穿参数（预览态） → 内容覆盖 → 栏目[通道].detailByModel[模型] → 栏目[通道].detail → 栏目通用
 * → 站点默认[通道].detailByModel[模型] → 站点默认[通道].detail → 主题默认
 */
async function resolveDetailComponent(
  site: CmsSiteRow,
  device: CmsDeviceChannel,
  channel: CmsChannelRow,
  contentTemplate?: string | null,
  contentModelId?: number | null,
  templateOverride?: string | null,
) {
  const theme = getTheme(site.theme);
  const tryOn = templateOverride && isTemplateRegistered(site.theme, 'detail', templateOverride) ? templateOverride : null;
  let name = tryOn || contentTemplate || null;
  const modelId = contentModelId ?? channel.modelId;
  const modelCode = modelId ? await getModelCode(modelId) : null;
  const pickDetail = (cfg: CmsSiteTemplateDefaults): string | null => {
    if (modelCode && cfg.detailByModel?.[modelCode]) return cfg.detailByModel[modelCode] ?? null;
    return cfg.detail ?? null;
  };
  name = name || pickDetail(channelTemplateOverrides(channel, device)) || channel.detailTemplate || null;
  name = name || pickDetail(siteTemplateDefaults(site, device)) || null;
  return resolveDetailTemplate(theme, name);
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
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  const siteTitle = site.title?.trim() || site.name;
  const title = overrides.title ?? siteTitle;
  const description = overrides.description ?? site.description ?? '';
  const canonical = origin && overrides.pathForCanonical !== undefined ? `${origin}${overrides.pathForCanonical}` : null;
  const image = overrides.ogImage ?? site.logo ?? null;
  const imageAbsolute = image && origin && image.startsWith('/') ? `${origin}${image}` : image;
  const twitterCard = settings.twitterCard === 'summary' ? 'summary' : 'summary_large_image';
  const twitterSite = typeof settings.twitterSite === 'string' && settings.twitterSite.trim()
    ? settings.twitterSite.trim()
    : null;
  const defaultImageAlt = typeof settings.socialImageAlt === 'string' && settings.socialImageAlt.trim()
    ? settings.socialImageAlt.trim()
    : site.name;
  return {
    title,
    keywords: overrides.keywords ?? site.keywords ?? '',
    description,
    canonical,
    ogTitle: overrides.ogTitle ?? title,
    ogDescription: overrides.ogDescription ?? description,
    ogImage: imageAbsolute,
    ogImageAlt: overrides.ogImageAlt ?? (imageAbsolute ? defaultImageAlt : null),
    ogType: overrides.ogType ?? 'website',
    ogUrl: overrides.ogUrl ?? canonical,
    ogSiteName: overrides.ogSiteName ?? site.name,
    articlePublishedTime: overrides.articlePublishedTime ?? null,
    articleModifiedTime: overrides.articleModifiedTime ?? null,
    articleAuthor: overrides.articleAuthor ?? null,
    twitterCard: overrides.twitterCard ?? twitterCard,
    twitterSite: overrides.twitterSite ?? twitterSite,
    twitterCreator: overrides.twitterCreator ?? null,
    twitterTitle: overrides.twitterTitle ?? overrides.ogTitle ?? title,
    twitterDescription: overrides.twitterDescription ?? overrides.ogDescription ?? description,
    twitterImage: overrides.twitterImage ?? imageAbsolute,
    twitterImageAlt: overrides.twitterImageAlt ?? overrides.ogImageAlt ?? (imageAbsolute ? defaultImageAlt : null),
    jsonLd: overrides.jsonLd ?? null,
  };
}

export { mergeSeo as mergeCmsSeo };

async function buildBaseContext(site: CmsSiteRow, baseUrl: string, seo: CmsSeo, analyticsContentId?: number): Promise<CmsBaseContext> {
  const [tree, fragments, friendLinks, ads, langAlternates] = await Promise.all([
    listCmsChannelTree({ siteId: site.id, status: 'enabled' }, { skipAccessCheck: true }),
    getFragmentMap(site.id),
    listEnabledFriendLinks(site.id),
    getActiveAds(site.id),
    buildLangAlternates(site),
  ]);
  const analyticsSiteKey = (site.settings as Record<string, unknown> | null)?.analyticsSiteKey;
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
      themeConfig: resolveThemeConfig(site.theme, site.settings as Record<string, unknown> | null),
    },
    baseUrl,
    nav: navFromTree(tree, baseUrl),
    fragments,
    ads,
    friendLinks: friendLinks.map((l) => ({ name: l.name, url: l.url, logo: l.logo })),
    seo,
    searchUrl: `${baseUrl}/search`,
    analytics: typeof analyticsSiteKey === 'string' && analyticsSiteKey
      ? { siteKey: analyticsSiteKey, ...(analyticsContentId ? { contentId: analyticsContentId } : {}) }
      : null,
    langAlternates,
  };
}

/**
 * 多语言站点关联（P5）：站点 settings.language 声明本站语言，
 * settings.langLinks=[{language,siteCode}] 关联其他语言版本站点。
 * 生成 hreflang alternate 列表（含本站）；未配置返回空数组。
 */
async function buildLangAlternates(site: CmsSiteRow): Promise<CmsBaseContext['langAlternates']> {
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  const language = typeof settings.language === 'string' ? settings.language.trim() : '';
  const rawLinks = Array.isArray(settings.langLinks) ? settings.langLinks : [];
  const links = rawLinks
    .map((l) => l as { language?: unknown; siteCode?: unknown })
    .filter((l): l is { language: string; siteCode: string } =>
      typeof l.language === 'string' && l.language.trim() !== '' && typeof l.siteCode === 'string' && l.siteCode.trim() !== '')
    .map((l) => ({ language: l.language.trim(), siteCode: l.siteCode.trim() }));
  if (!language || links.length === 0) return [];

  const linkedSites = await db.query.cmsSites.findMany({
    where: and(inArray(cmsSites.code, links.map((l) => l.siteCode)), eq(cmsSites.status, 'enabled')),
  });
  const siteByCode = new Map(linkedSites.map((s) => [s.code, s]));
  const urlOf = (s: CmsSiteRow) => siteOrigin(s) ?? `/__cms/${s.code}`;

  const alternates: CmsBaseContext['langAlternates'] = [
    { language, name: site.name, url: urlOf(site) || '/', current: true },
  ];
  for (const link of links) {
    const target = siteByCode.get(link.siteCode);
    if (!target || target.id === site.id) continue;
    alternates.push({ language: link.language, name: target.name, url: urlOf(target), current: false });
  }
  return alternates.length > 1 ? alternates : [];
}

function toContentItem(row: CmsContentRow, baseUrl: string, channelPath: string): CmsContentItem {
  const isExternal = !!row.externalLink?.trim();
  const media = (row.mediaData ?? {}) as { images?: unknown[]; mediaType?: 'video' | 'audio' };
  return {
    id: row.id,
    title: row.title,
    url: isExternal ? row.externalLink! : contentUrl(baseUrl, channelPath, row),
    isExternal,
    contentType: row.contentType,
    summary: row.summary?.trim() ? row.summary : (row.body ? stripHtml(row.body).slice(0, 120) : null),
    coverImage: row.coverImage ?? null,
    coverThumb: row.coverThumb ?? null,
    imageCount: Array.isArray(media.images) ? media.images.length : 0,
    mediaType: row.contentType === 'media' ? (media.mediaType ?? 'video') : null,
    author: row.author ?? null,
    source: row.source ?? null,
    publishedAt: formatNullableDateTime(row.publishedAt),
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    favoriteCount: row.favoriteCount,
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
/** 可视化搭建页面 URL：/p/{slug}/ */
export function customPageUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/p/${slug}/`;
}

/** 渲染可视化搭建页面（含 content-list 区块数据预取） */
export async function renderCustomPage(
  site: CmsSiteRow,
  baseUrl: string,
  pageRow: import('../../db/schema').CmsPageRow,
  opts?: { asHome?: boolean },
): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const seo = mergeSeo(site, {
    title: pageRow.seoTitle ?? (opts?.asHome ? undefined : `${pageRow.name} - ${site.title?.trim() || site.name}`),
    keywords: pageRow.seoKeywords ?? undefined,
    description: pageRow.seoDescription ?? undefined,
    pathForCanonical: opts?.asHome ? '/' : customPageUrl('', pageRow.slug),
  });
  const base = await buildBaseContext(site, baseUrl, seo);
  const blocks = (pageRow.blocks ?? []) as import('@zenith/shared').CmsPageBlock[];
  // content-list 区块数据预取
  const channelPathMap = await loadChannelPathMap(site.id);
  const contentListData = new Map<string, CmsContentItem[]>();
  for (const block of blocks) {
    if (block.type !== 'content-list') continue;
    const channelId = Number(block.props.channelId) || undefined;
    const count = Math.min(20, Math.max(1, Number(block.props.count) || 5));
    const mode = block.props.mode === 'recommend' || block.props.mode === 'hot' ? block.props.mode : 'latest';
    const rows = await listBlockContents(site.id, { channelId, count, mode });
    contentListData.set(block.id, rows.map((row) => toContentItem(row, baseUrl, channelPathMap.get(row.channelId) ?? '')));
  }
  const blocksHtml = renderBlocksHtml({ blocks, ctx: base, contentListData });
  const html = renderDoc(resolveCustomPageTemplate(theme), {
    ...base,
    page: { name: pageRow.name, slug: pageRow.slug },
    blocksHtml,
  });
  return { status: 200, html, kind: opts?.asHome ? 'home' : 'page' };
}

async function listBlockContents(siteId: number, opts: { channelId?: number; count: number; mode: 'latest' | 'recommend' | 'hot' }): Promise<CmsContentRow[]> {
  const conds = [eq(cmsContents.siteId, siteId), eq(cmsContents.status, 'published'), isNull(cmsContents.deletedAt)];
  if (opts.channelId) conds.push(eq(cmsContents.channelId, opts.channelId));
  if (opts.mode === 'recommend') conds.push(eq(cmsContents.isRecommend, true));
  if (opts.mode === 'hot') conds.push(eq(cmsContents.isHot, true));
  return db.select().from(cmsContents)
    .where(and(...conds))
    .orderBy(desc(cmsContents.isTop), desc(cmsContents.publishedAt))
    .limit(opts.count);
}

export async function renderHomePage(site: CmsSiteRow, baseUrl: string): Promise<RenderResult> {
  // 可视化页面接管首页（isHome=true 的启用页面优先）
  const { getHomeTakeoverPage } = await import('./cms-pages.service');
  const takeover = await getHomeTakeoverPage(site.id);
  if (takeover) return renderCustomPage(site, baseUrl, takeover, { asHome: true });
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

export async function renderChannelPage(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow, page = 1, device: CmsDeviceChannel = 'pc', templateOverride?: string | null): Promise<RenderResult> {
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
    // 栏目 settings.formCode 绑定自定义表单（联系我们/报名等）
    const formCode = typeof (channel.settings as Record<string, unknown> | null)?.formCode === 'string'
      ? String((channel.settings as Record<string, unknown>).formCode)
      : null;
    const form = formCode ? await getCmsFormByCode(site.id, formCode) : null;
    const html = renderDoc(theme.templates.page, {
      ...base,
      channel: toChannelInfo(channel, baseUrl),
      breadcrumbs,
      contentHtml: channel.pageContent ?? '',
      form: form ? {
        code: form.code,
        name: form.name,
        action: `/api/public/cms/forms/${site.code}/${form.code}`,
        returnUrl: channelUrl(baseUrl, channel.path),
        successMessage: form.successMessage ?? null,
        fields: (form.fields ?? []) as CmsFormField[],
        captcha: resolveCmsFormCaptcha(form, site),
      } : null,
    });
    return { status: 200, html, kind: 'page' };
  }

  const { total, rows } = await listPublishedContents(site.id, channel.id, page, channel.pageSize);
  if (page > 1 && rows.length === 0) return renderNotFound(site, baseUrl, `/${channel.path}/index_${page}.html`);
  const html = renderDoc(resolveListComponent(site, device, channel, templateOverride), {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    items: rows.map((r) => toContentItem(r, baseUrl, channel.path)),
    pagination: buildPagination(baseUrl, channel.path, page, channel.pageSize, total),
  });
  return { status: 200, html, kind: 'list' };
}

/** 详情页专属上下文片段：形态数据 + 正文分页 */
function buildDetailExtras(row: CmsContentRow, resolvedBody: string | null, baseUrl: string, channelPath: string, bodyPage: number) {
  const media = (row.mediaData ?? {}) as {
    images?: { url?: string; thumb?: string | null; caption?: string | null }[];
    mediaUrl?: string; poster?: string; duration?: string;
  };
  const albumImages = (Array.isArray(media.images) ? media.images : [])
    .filter((img) => typeof img?.url === 'string' && img.url)
    .map((img) => ({ url: img.url!, thumb: img.thumb ?? null, caption: img.caption ?? null }));

  const bodyPages = splitBodyPages(resolvedBody);
  const totalPages = bodyPages.length;
  const pageBody = bodyPages[Math.min(bodyPage, totalPages) - 1] ?? '';
  const bodyPagination = totalPages > 1 ? {
    page: bodyPage,
    totalPages,
    pages: bodyPages.map((_, i) => ({
      page: i + 1,
      url: contentUrl(baseUrl, channelPath, row, i + 1),
      current: i + 1 === bodyPage,
    })),
    prevUrl: bodyPage > 1 ? contentUrl(baseUrl, channelPath, row, bodyPage - 1) : null,
    nextUrl: bodyPage < totalPages ? contentUrl(baseUrl, channelPath, row, bodyPage + 1) : null,
  } : null;

  return {
    pageBody,
    totalPages,
    extras: {
      bodyPagination,
      albumImages,
      mediaUrl: media.mediaUrl ?? null,
      mediaPoster: media.poster ?? null,
      mediaDuration: media.duration ?? null,
    },
  };
}

/** 内容正文分页数（静态化生成 _n.html 时用；映射内容透传来源正文） */
export async function countContentBodyPages(row: Pick<CmsContentRow, 'body' | 'extend' | 'mappingSourceId'>): Promise<number> {
  const resolved = await resolveContentBodyExtend(row);
  return splitBodyPages(resolved.body).length;
}

export async function renderDetailPage(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow, idOrSlug: string, device: CmsDeviceChannel = 'pc', bodyPage = 1, templateOverride?: string | null): Promise<RenderResult> {
  const row = await getPublishedContent(site.id, channel.id, idOrSlug);
  if (!row) return renderNotFound(site, baseUrl, `/${channel.path}/${idOrSlug}.html`);
  if (row.externalLink?.trim()) return { status: 302, location: row.externalLink };

  const canonicalPath = contentUrl('', channel.path, row, bodyPage);
  const origin = siteOrigin(site);
  const seo = mergeSeo(site, {
    title: (row.seoTitle ?? `${row.title} - ${site.title?.trim() || site.name}`) + (bodyPage > 1 ? `（第${bodyPage}页）` : ''),
    keywords: row.seoKeywords ?? undefined,
    description: row.seoDescription ?? row.summary ?? undefined,
    ogTitle: row.title,
    ogImage: row.coverImage ?? undefined,
    ogImageAlt: row.socialImageAlt ?? undefined,
    ogType: 'article',
    articlePublishedTime: formatIso8601(row.publishedAt),
    articleModifiedTime: formatIso8601(row.updatedAt),
    articleAuthor: row.author ?? null,
    twitterCreator: row.twitterCreator ?? null,
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
  const [base, breadcrumbs, adjacent, tags, linkWords, comments, relatedRows, resolved] = await Promise.all([
    buildBaseContext(site, baseUrl, seo, row.id),
    buildBreadcrumbs(site, baseUrl, channel),
    getAdjacentContents(row),
    listContentTags(row.id),
    getEnabledLinkWords(site.id),
    listApprovedComments(row.id),
    listRelatedContents(row),
    resolveContentBodyExtend(row),
  ]);
  const related = await buildRelatedLinks(baseUrl, relatedRows);
  const { pageBody, totalPages, extras } = buildDetailExtras(row, resolved.body, baseUrl, channel.path, bodyPage);
  if (bodyPage > totalPages) return renderNotFound(site, baseUrl, `/${channel.path}/${idOrSlug}_${bodyPage}.html`);
  const detailComponent = await resolveDetailComponent(site, device, channel, row.detailTemplate, row.modelId, templateOverride);
  const html = renderDoc(detailComponent, {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    content: {
      ...toContentItem(row, baseUrl, channel.path),
      body: applyPollMarkers(applyLinkWords(pageBody, linkWords), site.code),
      ...extras,
      extend: resolved.extend,
      tags: tags.map((t) => ({ name: t.name, slug: t.slug, url: tagUrl(baseUrl, t.slug) })),
      prev: adjacent.prev ? { title: adjacent.prev.title, url: contentUrl(baseUrl, channel.path, adjacent.prev) } : null,
      next: adjacent.next ? { title: adjacent.next.title, url: contentUrl(baseUrl, channel.path, adjacent.next) } : null,
    },
    related,
    comments: comments.map((cm) => ({ id: cm.id, parentId: cm.parentId, nickname: cm.nickname, content: cm.content, likeCount: cm.likeCount, isMember: cm.memberId != null, createdAt: cm.createdAt })),
    commentForm: {
      action: '/api/public/cms/comments',
      contentId: row.id,
      returnUrl: contentUrl(baseUrl, channel.path, row),
      memberSubmitApi: `/api/member/cms/contents/${row.id}/comments`,
      captchaEnabled: isCaptchaEnabled(site),
    },
  });
  return { status: 200, html, kind: 'detail', contentId: row.id };
}

/** 相关文章行 → 前台链接（跨栏目取各自栏目路径） */
async function buildRelatedLinks(baseUrl: string, rows: CmsContentRow[]): Promise<{ title: string; url: string }[]> {
  if (rows.length === 0) return [];
  const channelIds = [...new Set(rows.map((r) => r.channelId))];
  const channels = await db.select({ id: cmsChannels.id, path: cmsChannels.path })
    .from(cmsChannels).where(inArray(cmsChannels.id, channelIds));
  const pathById = new Map(channels.map((ch) => [ch.id, ch.path]));
  return rows
    .filter((r) => pathById.has(r.channelId))
    .map((r) => ({ title: r.title, url: contentUrl(baseUrl, pathById.get(r.channelId)!, r) }));
}

/**
 * 草稿预览渲染（签名链接访问，不校验发布状态）：
 * 复用详情页模板，顶部注入预览提示条；无缓存、无静态回写、无浏览计数。
 */
export async function renderContentPreviewPage(site: CmsSiteRow, baseUrl: string, contentId: number, device: CmsDeviceChannel = 'pc'): Promise<RenderResult> {
  const [row] = await db.select().from(cmsContents)
    .where(and(eq(cmsContents.id, contentId), eq(cmsContents.siteId, site.id), isNull(cmsContents.deletedAt)))
    .limit(1);
  if (!row) return renderNotFound(site, baseUrl, `/preview/${contentId}`);
  const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, row.channelId)).limit(1);
  if (!channel) return renderNotFound(site, baseUrl, `/preview/${contentId}`);

  const seo = mergeSeo(site, {
    title: `【预览】${row.title}`,
    description: row.seoDescription ?? row.summary ?? undefined,
    pathForCanonical: contentUrl('', channel.path, row),
    ogTitle: row.title,
    ogImage: row.coverImage ?? undefined,
    ogImageAlt: row.socialImageAlt ?? undefined,
    ogType: 'article',
    articlePublishedTime: formatIso8601(row.publishedAt),
    articleModifiedTime: formatIso8601(row.updatedAt),
    articleAuthor: row.author ?? null,
    twitterCreator: row.twitterCreator ?? null,
  });
  const [base, breadcrumbs, tags, linkWords, resolved] = await Promise.all([
    buildBaseContext(site, baseUrl, seo),
    buildBreadcrumbs(site, baseUrl, channel),
    listContentTags(row.id),
    getEnabledLinkWords(site.id),
    resolveContentBodyExtend(row),
  ]);
  const previewComponent = await resolveDetailComponent(site, device, channel, row.detailTemplate, row.modelId);
  const { pageBody: previewBody, extras: previewExtras } = buildDetailExtras(row, resolved.body, baseUrl, channel.path, 1);
  const html = renderDoc(previewComponent, {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    content: {
      ...toContentItem(row, baseUrl, channel.path),
      body: applyPollMarkers(applyLinkWords(previewBody, linkWords), site.code),
      ...previewExtras,
      extend: resolved.extend,
      tags: tags.map((t) => ({ name: t.name, slug: t.slug, url: tagUrl(baseUrl, t.slug) })),
      prev: null,
      next: null,
    },
    related: [],
    comments: [],
    commentForm: {
      action: '/api/public/cms/comments',
      contentId: row.id,
      returnUrl: contentUrl(baseUrl, channel.path, row),
      memberSubmitApi: `/api/member/cms/contents/${row.id}/comments`,
      captchaEnabled: isCaptchaEnabled(site),
    },
  });
  const statusLabel = CMS_CONTENT_STATUS_LABELS[row.status] ?? row.status;
  const banner = '<div style="position:sticky;top:0;z-index:9999;background:#fff7e6;border-bottom:1px solid #ffd591;'
    + 'color:#874d00;padding:8px 16px;font-size:13px;text-align:center">'
    + `草稿预览 — 当前状态：${statusLabel}；本页面由带签名的临时链接生成，与最终发布效果可能存在差异</div>`;
  return { status: 200, html: html.replace(/(<body[^>]*>)/i, `$1${banner}`), kind: 'detail', contentId: row.id };
}

export async function renderSearchPage(
  site: CmsSiteRow,
  baseUrl: string,
  keyword: string,
  page = 1,
  track?: { ip: string | null; userAgent: string | null },
): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const pageSize = 10;
  const seo = mergeSeo(site, { title: keyword ? `搜索：${keyword} - ${site.name}` : `搜索 - ${site.name}` });
  const base = await buildBaseContext(site, baseUrl, seo);
  const result = keyword
    ? await searchCmsContents({ siteId: site.id, keyword, page, pageSize, skipAccessCheck: true })
    : { list: [], total: 0, page, pageSize, tokens: [] };
  // 搜索日志（仅首屏记一次，翻页不重复计）
  if (track && keyword && page === 1) {
    const { recordCmsSearchLog } = await import('./cms-stats.service');
    recordCmsSearchLog({ siteId: site.id, keyword, resultCount: result.total, ip: track.ip, userAgent: track.userAgent });
  }
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

// ─── 前台问卷页（P3；动态成分低，可静态化，提交走 API）───────────────────────────
export async function renderSurveyPage(site: CmsSiteRow, baseUrl: string, code: string): Promise<RenderResult> {
  const { getPublishedSurveyByCode } = await import('./cms-surveys.service');
  const survey = await getPublishedSurveyByCode(site.id, code);
  if (!survey) return renderNotFound(site, baseUrl, `/survey/${code}/`);
  const seo = mergeSeo(site, {
    title: `${survey.title} - ${site.title?.trim() || site.name}`,
    description: survey.description ?? undefined,
    pathForCanonical: `/survey/${code}/`,
  });
  const base = await buildBaseContext(site, baseUrl, seo);
  const html = renderDoc(resolveSurveyTemplate(getTheme(site.theme)), {
    ...base,
    breadcrumbs: [
      { name: '首页', url: `${baseUrl}/` },
      { name: survey.title, url: `${baseUrl}/survey/${code}/` },
    ],
    survey: {
      id: survey.id,
      code: survey.code,
      title: survey.title,
      description: survey.description ?? null,
      allowAnonymous: survey.allowAnonymous,
      questions: [...survey.questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map((q) => ({
        id: q.id, label: q.label, type: q.type, required: q.required, options: q.options ?? [],
      })),
    },
    submitForm: {
      action: `/api/public/cms/surveys/${site.code}/${survey.code}`,
      memberSubmitApi: `/api/member/cms/surveys/${survey.id}/submit`,
      returnUrl: `${baseUrl}/survey/${code}/`,
    },
  });
  return { status: 200, html, kind: 'page' };
}

// ─── 标签聚合页 ───────────────────────────────────────────────────────────────
export async function findTagBySlug(siteId: number, slug: string): Promise<CmsTagRow | null> {
  const [row] = await db.select().from(cmsTags)
    .where(and(eq(cmsTags.siteId, siteId), eq(cmsTags.slug, slug)))
    .limit(1);
  return row ?? null;
}

/** 站点全部标签（静态化/sitemap 用） */
export async function listSiteTags(siteId: number): Promise<CmsTagRow[]> {
  return db.select().from(cmsTags).where(eq(cmsTags.siteId, siteId));
}

export async function renderTagPage(site: CmsSiteRow, baseUrl: string, slug: string, page = 1): Promise<RenderResult> {
  const theme = getTheme(site.theme);
  const tag = await findTagBySlug(site.id, slug);
  if (!tag) return renderNotFound(site, baseUrl, tagUrl('', slug, page));
  const seo = mergeSeo(site, {
    title: `标签：${tag.name} - ${site.title?.trim() || site.name}`,
    keywords: tag.name,
    pathForCanonical: tagUrl('', slug, page),
  });
  const base = await buildBaseContext(site, baseUrl, seo);
  const pageSize = 20;
  const { total, rows } = await listPublishedContentsByTag(site.id, tag.id, page, pageSize);
  if (page > 1 && rows.length === 0) return renderNotFound(site, baseUrl, tagUrl('', slug, page));
  const channelPathMap = await loadChannelPathMap(site.id);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const window = 5;
  const start = Math.max(1, Math.min(page - Math.floor(window / 2), totalPages - window + 1));
  const pages = [];
  for (let p = start; p <= Math.min(totalPages, start + window - 1); p++) {
    pages.push({ page: p, url: tagUrl(baseUrl, slug, p), current: p === page });
  }
  const html = renderDoc(theme.templates.tag, {
    ...base,
    tag: { name: tag.name, slug: tag.slug, contentCount: tag.contentCount },
    breadcrumbs: [
      { name: '首页', url: `${baseUrl}/` },
      { name: `标签：${tag.name}`, url: tagUrl(baseUrl, slug) },
    ],
    items: rows.map((r) => toContentItem(r, baseUrl, channelPathMap.get(r.channelId) ?? '')),
    pagination: {
      page, pageSize, total, totalPages,
      prevUrl: page > 1 ? tagUrl(baseUrl, slug, page - 1) : null,
      nextUrl: page < totalPages ? tagUrl(baseUrl, slug, page + 1) : null,
      pages,
    },
  });
  return { status: 200, html, kind: 'list' };
}

// ─── RSS 2.0 ─────────────────────────────────────────────────────────────────
function rssEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 生成站点或栏目 RSS（最新 50 条已发布内容） */
export async function generateRssXml(site: CmsSiteRow, channel?: CmsChannelRow | null): Promise<string> {
  const origin = siteOrigin(site) ?? '';
  const rows = await db.select().from(cmsContents)
    .where(and(
      eq(cmsContents.siteId, site.id),
      ...(channel ? [eq(cmsContents.channelId, channel.id)] : []),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
    ))
    .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
    .limit(50);
  const channelPathMap = await loadChannelPathMap(site.id);
  const feedTitle = channel ? `${channel.name} - ${site.name}` : (site.title?.trim() || site.name);
  const feedLink = channel ? `${origin}${channelUrl('', channel.path)}` : `${origin}/`;
  const items = rows.map((row) => {
    const link = row.externalLink?.trim() || `${origin}${contentUrl('', channelPathMap.get(row.channelId) ?? '', row)}`;
    return [
      '    <item>',
      `      <title>${rssEscape(row.title)}</title>`,
      `      <link>${rssEscape(link)}</link>`,
      `      <guid isPermaLink="false">cms-content-${row.id}</guid>`,
      row.summary ? `      <description>${rssEscape(stripHtml(row.summary).slice(0, 300))}</description>` : '',
      row.publishedAt ? `      <pubDate>${new Date(row.publishedAt).toUTCString()}</pubDate>` : '',
      '    </item>',
    ].filter(Boolean).join('\n');
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${rssEscape(feedTitle)}</title>`,
    `    <link>${rssEscape(feedLink)}</link>`,
    `    <description>${rssEscape(site.description ?? feedTitle)}</description>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

// ─── URL 解析：站内相对路径 → 渲染 ───────────────────────────────────────────────
/**
 * 解析并渲染站内路径（不含 search/rss，由前台路由单独处理）。
 * 约定：'' 首页；'{path}/' 栏目页1；'{path}/index_{n}.html' 栏目页n；
 * '{path}/{idOrSlug}.html' 详情；'tag/{slug}/' 与 'tag/{slug}/index_{n}.html' 标签页。
 */
/** 站内路径分发渲染；templateOverride = 预览态「模板试穿」参数（仅列表/详情页生效，非法名忽略） */
export async function renderSitePath(site: CmsSiteRow, baseUrl: string, rawPath: string, device: CmsDeviceChannel = 'pc', templateOverride?: string | null): Promise<RenderResult> {
  const cleaned = rawPath.replace(/^\/+|\/+$/g, '');
  if (cleaned === '' || cleaned === 'index.html') {
    return renderHomePage(site, baseUrl);
  }

  // 标签聚合页
  const tagMatch = /^tag\/([^/]+)(?:\/(?:index_(\d+)\.html)?)?$/.exec(cleaned);
  if (tagMatch) {
    return renderTagPage(site, baseUrl, decodeURIComponent(tagMatch[1]), Number(tagMatch[2] ?? 1));
  }

  // 可视化搭建页面 /p/{slug}/
  const pageMatch2 = /^p\/([a-z0-9-]+)(?:\/(?:index\.html)?)?$/.exec(cleaned);
  if (pageMatch2) {
    const { getPublishedPageBySlug } = await import('./cms-pages.service');
    const pageRow = await getPublishedPageBySlug(site.id, pageMatch2[1]);
    if (!pageRow) return renderNotFound(site, baseUrl, `/${cleaned}`);
    return renderCustomPage(site, baseUrl, pageRow);
  }

  // 前台问卷页 /survey/{code}/
  const surveyMatch = /^survey\/([a-z0-9-]+)(?:\/(?:index\.html)?)?$/.exec(cleaned);
  if (surveyMatch) {
    return renderSurveyPage(site, baseUrl, surveyMatch[1]);
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
      return renderChannelPage(site, baseUrl, channel, Number(pageMatch[1]), device, templateOverride);
    }
    if (!dir) return renderNotFound(site, baseUrl, `/${cleaned}`);
    const channel = await findChannelByPath(site.id, dir);
    if (!channel) return renderNotFound(site, baseUrl, `/${cleaned}`);
    const fileBase = file.slice(0, -'.html'.length);
    // 正文多页：{idOrSlug}_{n}.html（slug 不含下划线，无歧义）
    const bodyPageMatch = /^(.+)_(\d+)$/.exec(fileBase);
    if (bodyPageMatch && Number(bodyPageMatch[2]) >= 2) {
      return renderDetailPage(site, baseUrl, channel, bodyPageMatch[1], device, Number(bodyPageMatch[2]), templateOverride);
    }
    return renderDetailPage(site, baseUrl, channel, fileBase, device, 1, templateOverride);
  }

  const channel = await findChannelByPath(site.id, cleaned);
  if (!channel) return renderNotFound(site, baseUrl, `/${cleaned}`);
  return renderChannelPage(site, baseUrl, channel, 1, device, templateOverride);
}
