import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq, and, desc, gt, isNull, inArray, or } from 'drizzle-orm';
import { db } from '../../db';
import { cmsChannels, cmsTags, cmsContentTags, cmsContents, cmsModels, cmsSites } from '../../db/schema';
import type { CmsSiteRow, CmsChannelRow, CmsContentRow, CmsTagRow } from '../../db/schema';
import { formatNullableDateTime, formatIso8601 } from '../../lib/datetime';
import { getBuiltinThemeFallback, resolveListTemplate, resolveDetailTemplate, resolveCustomPageTemplate, resolveInteractionTemplate, resolveThemeConfig } from '../../cms/themes/registry';
import { renderBlocksHtml } from '../../cms/themes/blocks';
import { filterCmsPageBlocksForViewer } from './cms-page-blocks';
import type {
  CmsBaseContext, CmsNavItem, CmsSeo, CmsContentItem, CmsPagination, CmsBreadcrumb, CmsChannelInfo,
  CmsThemeDataApi, CmsThemeContentCollection,
} from '../../cms/themes/types';
import { isHomeTemplateDefinition } from '../../cms/themes/sdk';
import { buildSiteThemeCss } from '../../cms/themes/theme-css';
import { resolveStaticFile } from './cms-static-path';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCmsModelFieldValues, buildCmsListModelFieldValues, loadCmsListModelFieldDefs, type CmsListModelFieldDefs } from './cms-model-field-values';
import { listCmsChannelTree } from './cms-channels.service';
import { channelUrl, tagUrl, contentUrl, customPageUrl, type CmsUrlChannel } from './cms-urls';
import { buildCmsLinkResolver, resolveCmsLink, type CmsLinkResolver } from './cms-link.service';
import { buildCmsPagination } from './cms-render-pagination';
import {
  listPublishedContents, listHomeContents, getPublishedContent, getAdjacentContents, listContentTags,
  listPublishedContentsByTag, listRelatedContents, resolveContentBodyExtend, findPublishedContentByStaticPath, type ResolvedCmsContentListRow,
} from './cms-contents.service';
import { cmsContentListColumns, listSummaryOf, type CmsContentLinkRow, type CmsContentListRow } from './cms-content-columns';
import { resolveCmsContentRow, resolveCmsContentRows, resolveCmsResourcePayload } from './cms-resource-refs.service';
import { listEnabledFriendLinks, listEnabledFriendLinkGroups } from './cms-friend-links.service';
import { searchCmsContents, stripHtml } from './cms-search.service';
import { getEnabledLinkWords, applyLinkWords } from './cms-link-words.service';
import { applyInteractionMarkers } from './cms-interactions.service';
import { isCaptchaEnabled } from './cms-captcha.service';
import { resolveCmsFormCaptcha } from './cms-form-captcha.service';
import { listApprovedComments } from './cms-comments.service';
import { getActiveAds } from './cms-ads.service';
import { getCmsFormByCode } from './cms-forms.service';
import {
  resolveCmsWidgetPlacements,
  resolveCmsWidgetSlotForRender,
} from './cms-widgets.service';
import type { CmsChannel, CmsFormField, CmsPageBlock, CmsResolvedWidget, CmsSiteTemplateDefaults } from '@zenith/shared/cms';
import { CMS_CONTENT_STATUS_LABELS, isValidCmsAssetUrl, isValidCmsLink } from '@zenith/shared/cms';
import { stripCmsPreviewScripts } from './cms-preview';
import { getEffectivelyEnabledCmsChannelIds } from './cms-channel-visibility.service';
import { sanitizeCmsHtml } from './cms-html-sanitizer';

// ─── URL 规则（站点内相对路径，静态文件名与之一一对应）──────────────────────────
export { channelUrl, tagUrl, contentUrl, customPageUrl, customPagePath } from './cms-urls';
export type { CmsUrlChannel } from './cms-urls';

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

// ─── 模板解析链 ───────────────────────────────────────────────────────────────
/** 站点 settings.defaultTemplates */
function siteTemplateDefaults(site: CmsSiteRow): CmsSiteTemplateDefaults {
  const settings = site.settings as Record<string, unknown> | null;
  return (settings?.defaultTemplates ?? {}) as CmsSiteTemplateDefaults;
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

/** 列表模板：试穿参数（预览态） → 栏目 → 站点默认 → 主题默认 */
function resolveListComponent(site: CmsSiteRow, channel: CmsChannelRow, templateOverride?: string | null) {
  const theme = getBuiltinThemeFallback(site.theme);
  const name = (templateOverride || null)
    || channel.listTemplate
    || siteTemplateDefaults(site).list
    || null;
  return { component: resolveListTemplate(theme, name), templateCode: name };
}

/**
 * 详情模板：试穿参数（预览态） → 内容覆盖 → 栏目详情模板
 * → 站点默认.detailByModel[模型] → 站点默认详情模板 → 主题默认
 *
 * 栏目级不做「按模型细分」：详情页只在内容主栏目下可达（getPublishedContent 锁 channelId），
 * 而内容 modelId 恒等于其主栏目的 modelId，栏目内模型唯一，按模型细分退化为
 * channel.detailTemplate 的重复槽位。站点默认跨栏目生效，模型有区分度，故保留。
 */
async function resolveDetailComponent(
  site: CmsSiteRow,
  channel: CmsChannelRow,
  contentTemplate?: string | null,
  contentModelId?: number | null,
  templateOverride?: string | null,
) {
  const theme = getBuiltinThemeFallback(site.theme);
  let name = (templateOverride || null) || contentTemplate || channel.detailTemplate || null;
  if (!name) {
    const modelId = contentModelId ?? channel.modelId;
    const modelCode = modelId ? await getModelCode(modelId) : null;
    const siteCfg = siteTemplateDefaults(site);
    name = (modelCode ? siteCfg.detailByModel?.[modelCode] ?? null : null) || siteCfg.detail || null;
  }
  return { component: resolveDetailTemplate(theme, name), templateCode: name };
}

// ─── 上下文组装 ───────────────────────────────────────────────────────────────
async function navFromTree(tree: CmsChannel[], baseUrl: string, siteId: number): Promise<CmsNavItem[]> {
  const rawLinks: string[] = [];
  const collect = (nodes: CmsChannel[]) => {
    for (const node of nodes) {
      if (node.type === 'link' && node.linkUrl) rawLinks.push(node.linkUrl);
      if (node.children?.length) collect(node.children);
    }
  };
  collect(tree);
  const resolveLink = await buildCmsLinkResolver(siteId, baseUrl, rawLinks);
  const walk = (nodes: CmsChannel[]): CmsNavItem[] => nodes
    .filter((n) => n.visible)
    .map((n) => {
      const resolved = n.type === 'link' ? resolveLink(n.linkUrl) : null;
      return {
        id: n.id,
        name: n.name,
        url: n.type === 'link' ? (resolved?.url ?? '#') : channelUrl(baseUrl, n.path),
        target: n.type === 'link' ? (resolved?.isExternal ? '_blank' as const : '_self' as const) : '_self' as const,
        ...(n.children && n.children.length > 0 ? { children: walk(n.children) } : {}),
      };
    });
  return walk(tree);
}

export function mergeSeo(site: CmsSiteRow, overrides: Partial<CmsSeo> & { pathForCanonical?: string }): CmsSeo {
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

async function buildBaseContext(site: CmsSiteRow, baseUrl: string, seo: CmsSeo, analyticsContentId?: number): Promise<CmsBaseContext> {
  const [tree, friendLinks, friendLinkGroups, ads, langAlternates, assets] = await Promise.all([
    listCmsChannelTree({ siteId: site.id, status: 'enabled' }, { skipAccessCheck: true }),
    listEnabledFriendLinks(site.id, baseUrl),
    listEnabledFriendLinkGroups(site.id, baseUrl),
    getActiveAds(site.id, baseUrl),
    buildLangAlternates(site),
    resolveThemeAssets(site, baseUrl),
  ]);
  const analyticsSiteKey = (site.settings as Record<string, unknown> | null)?.analyticsSiteKey;
  // 站点 logo/favicon/主题配置、广告、友链都以素材句柄存储，
  // 整块上下文统一解析一次，避免逐个模板忘记解析而渲染出 cms-res:// 裸串
  const nav = await navFromTree(tree, baseUrl, site.id);
  return resolveCmsResourcePayload({
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
      extend: site.extend ?? {},
      settings: site.settings ?? {},
      themeConfig: resolveThemeConfig(site.theme, site.settings as Record<string, unknown> | null),
    },
    baseUrl,
    nav,
    ads,
    friendLinks: friendLinks.map((l) => ({ name: l.name, url: l.url, logo: l.logo })),
    friendLinkGroups,
    seo,
    searchUrl: `${baseUrl}/search`,
    analytics: typeof analyticsSiteKey === 'string' && analyticsSiteKey
      ? { siteKey: analyticsSiteKey, ...(analyticsContentId ? { contentId: analyticsContentId } : {}) }
      : null,
    langAlternates,
    audience: { dynamic: false, member: false },
    assets,
  }, site.id);
}

// ─── 主题样式资产 ─────────────────────────────────────────────────────────────

/**
 * 确保站点主题 CSS 资产已写盘（_assets/theme.{hash}.css），返回当前指纹与内容。
 * 渲染管线与前台 _assets 路由共用：文件缺失即补写自愈（fs.access 为 stat 级开销）。
 */
export async function ensureSiteThemeCssAsset(site: CmsSiteRow): Promise<{ relPath: string; hash: string; css: string; darkMode: 'auto' | 'light' | 'dark' }> {
  const theme = getBuiltinThemeFallback(site.theme);
  const result = buildSiteThemeCss(theme, site.settings as Record<string, unknown> | null);
  const relPath = `_assets/theme.${result.hash}.css`;
  const abs = resolveStaticFile(site.code, relPath);
  if (abs) {
    try {
      await fs.access(abs);
    } catch {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // 同 hash 内容恒等，并发写同名文件无害
      await fs.writeFile(abs, result.css, 'utf8');
    }
  }
  return { relPath, hash: result.hash, css: result.css, darkMode: result.darkMode };
}

/**
 * 主题样式资产装配：预览路径内联（改主题/参数即时可见、不落盘），
 * 正式渲染确保指纹资产落盘并输出外链。
 */
async function resolveThemeAssets(site: CmsSiteRow, baseUrl: string): Promise<CmsBaseContext['assets']> {
  const isPreview = baseUrl !== '';
  if (isPreview) {
    const theme = getBuiltinThemeFallback(site.theme);
    const result = buildSiteThemeCss(theme, site.settings as Record<string, unknown> | null);
    return { cssHref: null, inlineCss: result.css, darkMode: result.darkMode };
  }
  const asset = await ensureSiteThemeCssAsset(site);
  return { cssHref: `${baseUrl}/${asset.relPath}`, inlineCss: null, darkMode: asset.darkMode };
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

/** 列表项映射：只接受列表投影行（无 body），导语走 listSummaryOf（手填摘要 → 生成列 excerpt） */
function toContentItem(row: CmsContentListRow & { coverThumb?: string | null }, baseUrl: string, channel: CmsUrlChannel, resolveLink?: CmsLinkResolver, listFieldDefs?: Map<number, CmsListModelFieldDefs>): CmsContentItem {
  const rawLink = row.externalLink?.trim();
  // 链接型内容：解析后指向目标；目标已删除/下线时降级为不可点（避免指向必然 404 的自身详情页）
  // A resolver miss is a dead/invalid link. Never fall back to the raw value,
  // because old rows may still contain javascript:/protocol-relative payloads.
  const link = rawLink ? (resolveLink?.(rawLink) ?? null) : null;
  const media = (row.mediaData ?? {}) as { images?: unknown[]; mediaType?: 'video' | 'audio' };
  return {
    id: row.id,
    title: row.title,
    titleStyle: row.titleStyle ?? {},
    url: rawLink ? (link?.url ?? '#') : contentUrl(baseUrl, channel, row),
    isExternal: link?.isExternal ?? false,
    contentType: row.contentType,
    summary: listSummaryOf(row, 120),
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
    modelFields: listFieldDefs
      ? buildCmsListModelFieldValues(row.modelId, (row.extend ?? {}) as Record<string, unknown>, listFieldDefs)
      : [],
  };
}

function buildPagination(baseUrl: string, channelPath: string, page: number, pageSize: number, total: number): CmsPagination {
  return buildCmsPagination({
    page,
    pageSize,
    total,
    makeUrl: (p) => channelUrl(baseUrl, channelPath, p),
  });
}

async function buildBreadcrumbs(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow): Promise<CmsBreadcrumb[]> {
  const crumbs: CmsBreadcrumb[] = [{ name: '首页', url: `${baseUrl}/` }];
  const chain: CmsChannelRow[] = [];
  let cursor: CmsChannelRow | null = channel;
  while (cursor) {
    chain.unshift(cursor);
    if (cursor.parentId === 0) break;
    const [parent] = await db.select().from(cmsChannels).where(and(
      eq(cmsChannels.id, cursor.parentId),
      eq(cmsChannels.siteId, site.id),
      eq(cmsChannels.status, 'enabled'),
    )).limit(1);
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
  return row && (await getEffectivelyEnabledCmsChannelIds(siteId)).has(row.id) ? row : null;
}

/** 归档目录最多占 3 段（date 规则的 年/月/日） */
const MAX_ARCHIVE_SEGMENTS = 3;

/**
 * 按最长前缀查找栏目：详情页目录可能带归档段（`news/2026/7/5`），
 * 逐级剥离尾段重试。同名子栏目真实存在时会先命中子栏目，语义正确。
 */
async function findChannelByPathPrefix(siteId: number, dir: string): Promise<CmsChannelRow | null> {
  const segments = dir.split('/');
  const minLength = Math.max(1, segments.length - MAX_ARCHIVE_SEGMENTS);
  for (let length = segments.length; length >= minLength; length--) {
    const hit = await findChannelByPath(siteId, segments.slice(0, length).join('/'));
    if (hit) return hit;
  }
  return null;
}

// ─── 各页面渲染 ───────────────────────────────────────────────────────────────
/** 渲染可视化搭建页面（含 content-list 区块数据预取） */
export async function renderCustomPage(
  site: CmsSiteRow,
  baseUrl: string,
  pageRow: import('../../db/schema').CmsPageRow,
  opts?: { asHome?: boolean; member?: boolean },
): Promise<RenderResult> {
  const theme = getBuiltinThemeFallback(site.theme);
  const seo = mergeSeo(site, {
    title: pageRow.seoTitle ?? (opts?.asHome ? undefined : `${pageRow.name} - ${site.title?.trim() || site.name}`),
    keywords: pageRow.seoKeywords ?? undefined,
    description: pageRow.seoDescription ?? undefined,
    pathForCanonical: opts?.asHome ? '/' : customPageUrl('', pageRow),
  });
  const base = {
    ...await buildBaseContext(site, baseUrl, seo),
    audience: { dynamic: pageRow.requiresDynamic, member: opts?.member === true },
  };
  const resourceResolvedBlocks = await resolveCmsResourcePayload(filterCmsPageBlocksForViewer(
    (pageRow.blocks ?? []) as import('@zenith/shared').CmsPageBlock[],
    { member: opts?.member === true },
  ), site.id);
  const blocks = await resolveCmsPageBlockUrls(resourceResolvedBlocks, site.id, baseUrl);
  // content-list 区块数据预取
  const channelPathMap = await loadChannelPathMap(site.id);
  const hasChannelCodeBlock = blocks.some((b) => b.type === 'content-list' && typeof b.props.channelCode === 'string' && b.props.channelCode);
  const channelCodeMap = hasChannelCodeBlock ? await loadChannelCodeMap(site.id) : new Map<string, number>();
  const contentListData = new Map<string, CmsContentItem[]>();
  for (const block of blocks) {
    if (block.type !== 'content-list') continue;
    // 优先按栏目标识引用；旧页面配置仍存的是数值 id，保持兼容
    const code = typeof block.props.channelCode === 'string' ? block.props.channelCode : '';
    const channelId = (code ? channelCodeMap.get(code) : Number(block.props.channelId)) || undefined;
    const tagSlug = typeof block.props.tagSlug === 'string' && block.props.tagSlug.trim() ? block.props.tagSlug.trim() : undefined;
    const count = Math.min(20, Math.max(1, Number(block.props.count) || 5));
    const mode = block.props.mode === 'recommend' || block.props.mode === 'hot' ? block.props.mode : 'latest';
    const rows = await listBlockContents(site.id, { channelId, tagSlug, count, mode });
    const resolveLink = await buildCmsLinkResolver(site.id, baseUrl, rows.map((r) => r.externalLink));
    const listFieldDefs = await loadCmsListModelFieldDefs(rows.map((r) => r.modelId));
    contentListData.set(block.id, rows.map((row) => toContentItem(row, baseUrl, channelPathMap.get(row.channelId) ?? FALLBACK_URL_CHANNEL, resolveLink, listFieldDefs)));
  }
  const widgetData = await resolveCmsWidgetPlacements(
    site.id,
    baseUrl,
    blocks.flatMap((block) => block.type === 'widget-ref'
      ? [{
          key: block.id,
          widgetId: Number(block.props.widgetId),
          rendererKey: typeof block.props.rendererKey === 'string'
            ? block.props.rendererKey as import('@zenith/shared').CmsWidgetRendererKey
            : undefined,
        }]
      : []),
  );
  const blocksHtml = renderBlocksHtml({ blocks, contentListData, widgetData, themeCode: site.theme });
  const props = {
    ...base,
    page: { name: pageRow.name, slug: pageRow.slug },
    blocksHtml,
  };
  const html = renderDoc(resolveCustomPageTemplate(theme), props);
  return { status: 200, html, kind: opts?.asHome ? 'home' : 'page' };
}

async function listBlockContents(siteId: number, opts: { channelId?: number; tagSlug?: string; count: number; mode: 'latest' | 'recommend' | 'hot' }): Promise<ResolvedCmsContentListRow[]> {
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(siteId);
  if (effectiveChannelIds.size === 0 || (opts.channelId != null && !effectiveChannelIds.has(opts.channelId))) return [];
  const conds = [
    eq(cmsContents.siteId, siteId),
    eq(cmsContents.status, 'published'),
    isNull(cmsContents.deletedAt),
    isNull(cmsContents.archivedAt),
    or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date()))!,
    inArray(cmsContents.channelId, [...effectiveChannelIds]),
  ];
  if (opts.tagSlug) {
    // 标签聚合：跨栏目取同标签内容（专题页典型场景）；标签模式下忽略栏目条件
    conds.push(inArray(
      cmsContents.id,
      db.select({ id: cmsContentTags.contentId })
        .from(cmsContentTags)
        .innerJoin(cmsTags, eq(cmsContentTags.tagId, cmsTags.id))
        .where(and(eq(cmsTags.siteId, siteId), eq(cmsTags.slug, opts.tagSlug))),
    ));
  } else if (opts.channelId) {
    conds.push(eq(cmsContents.channelId, opts.channelId));
  }
  if (opts.mode === 'recommend') conds.push(eq(cmsContents.isRecommend, true));
  if (opts.mode === 'hot') conds.push(eq(cmsContents.isHot, true));
  const rows = await db.select(cmsContentListColumns).from(cmsContents)
    .where(and(...conds))
    .orderBy(desc(cmsContents.isTop), desc(cmsContents.publishedAt), desc(cmsContents.id))
    .limit(opts.count);
  return resolveCmsContentRows(rows, siteId);
}

function blockUrlKey(key: string): 'asset' | 'link' | null {
  if (/(?:src|image|poster|logo|icon)$/i.test(key)) return 'asset';
  if (/(?:url|href|link)$/i.test(key)) return 'link';
  return null;
}

async function resolveCmsPageBlockUrls(
  blocks: CmsPageBlock[],
  siteId: number,
  baseUrl: string,
): Promise<CmsPageBlock[]> {
  const rawLinks: string[] = [];
  const walkCollect = (value: unknown, key?: string) => {
    if (typeof value === 'string' && key && blockUrlKey(key)) {
      rawLinks.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => walkCollect(item, key));
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => walkCollect(child, childKey));
  };
  blocks.forEach((block) => walkCollect(block.props));
  const resolver = await buildCmsLinkResolver(siteId, baseUrl, rawLinks);
  const mapValue = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string' && key) {
      const kind = blockUrlKey(key);
      if (kind === 'asset') return isValidCmsAssetUrl(value) ? value : '';
      if (kind === 'link') return isValidCmsLink(value) ? (resolver(value)?.url ?? '') : '';
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => mapValue(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, mapValue(child, childKey)]));
    return value;
  };
  return blocks.map((block) => ({ ...block, props: mapValue(block.props) as Record<string, unknown> }));
}

/** Theme API 数据门面的单次渲染配额：防止 load() 写出取数风暴 */
const THEME_DATA_MAX_CALLS = 20;
const THEME_DATA_MAX_LIMIT = 100;

/**
 * 创建主题模板 load() 可用的只读数据门面（站点隔离；同参数去重复用；限流保护）。
 * 只返回启用栏目下已发布内容，URL 统一经 contentUrl() 生成。
 */
export function createCmsThemeDataApi(site: CmsSiteRow, baseUrl: string): CmsThemeDataApi {
  const memo = new Map<string, Promise<CmsThemeContentCollection>>();
  let calls = 0;
  return {
    contents: {
      list: (query) => {
        const key = JSON.stringify(['contents', query.channelCode ?? '', query.limit, query.recommend ?? false, query.hot ?? false]);
        const cached = memo.get(key);
        if (cached) return cached;
        if (++calls > THEME_DATA_MAX_CALLS) {
          throw new Error(`主题模板单次渲染取数超过 ${THEME_DATA_MAX_CALLS} 次，请合并查询`);
        }
        const promise = (async (): Promise<CmsThemeContentCollection> => {
          const limit = Math.min(THEME_DATA_MAX_LIMIT, Math.max(1, Math.floor(query.limit) || 1));
          let channel: { id: number; code: string; name: string; path: string } | null = null;
          if (query.channelCode) {
            const [row] = await db.select({
              id: cmsChannels.id, code: cmsChannels.code, name: cmsChannels.name, path: cmsChannels.path,
            }).from(cmsChannels).where(and(
              eq(cmsChannels.siteId, site.id),
              eq(cmsChannels.code, query.channelCode),
              eq(cmsChannels.status, 'enabled'),
            )).limit(1);
            // 栏目不存在时返回空集而不是抛错：主题参数配错栏目 code 不应打挂整个首页
            if (!row) return { channel: null, list: [] };
            channel = row;
          }
          const mode = query.recommend ? 'recommend' : (query.hot ? 'hot' : 'latest');
          const rows = await listBlockContents(site.id, { channelId: channel?.id, count: limit, mode });
          const channelPathMap = await loadChannelPathMap(site.id);
          const resolveLink = await buildCmsLinkResolver(site.id, baseUrl, rows.map((r) => r.externalLink));
          const listFieldDefs = await loadCmsListModelFieldDefs(rows.map((r) => r.modelId));
          return {
            channel: channel
              ? { id: channel.id, code: channel.code, name: channel.name, url: channelUrl(baseUrl, channel.path) }
              : null,
            list: rows.map((row) => toContentItem(row, baseUrl, channelPathMap.get(row.channelId) ?? FALLBACK_URL_CHANNEL, resolveLink, listFieldDefs)),
          };
        })();
        memo.set(key, promise);
        return promise;
      },
    },
  };
}

interface RenderHomePageOptions {
  homeSidebarOverride?: CmsResolvedWidget | null;
  skipTakeover?: boolean;
}

export async function renderHomePage(
  site: CmsSiteRow,
  baseUrl: string,
  viewer?: { member?: boolean },
  options?: RenderHomePageOptions,
): Promise<RenderResult> {
  // 可视化页面接管首页（isHome=true 的启用页面优先）
  if (!options?.skipTakeover) {
    const { getHomeTakeoverPage } = await import('./cms-pages.service');
    const takeover = await getHomeTakeoverPage(site.id);
    if (takeover) return renderCustomPage(site, baseUrl, takeover, { asHome: true, member: viewer?.member });
  }
  const theme = getBuiltinThemeFallback(site.theme);
  const seo = mergeSeo(site, { pathForCanonical: '/' });
  const homeSidebarPromise = options && Object.hasOwn(options, 'homeSidebarOverride')
    ? Promise.resolve(options.homeSidebarOverride ?? null)
    : resolveCmsWidgetSlotForRender(site.id, 'home.sidebar', baseUrl);
  const [base, home, homeSidebar] = await Promise.all([
    buildBaseContext(site, baseUrl, seo),
    listHomeContents(site.id),
    homeSidebarPromise,
  ]);
  const channelPathMap = await loadChannelPathMap(site.id);
  const resolveLink = await buildCmsLinkResolver(
    site.id, baseUrl,
    [...home.latest, ...home.recommended, ...home.hot].map((r) => r.externalLink),
  );
  const homeFieldDefs = await loadCmsListModelFieldDefs(
    [...home.latest, ...home.recommended, ...home.hot].map((r) => r.modelId),
  );
  const toItem = (row: ResolvedCmsContentListRow) => toContentItem(row, baseUrl, channelPathMap.get(row.channelId) ?? FALLBACK_URL_CHANNEL, resolveLink, homeFieldDefs);
  const props = {
    ...base,
    latest: home.latest.map(toItem),
    recommended: home.recommended.map(toItem),
    hot: home.hot.map(toItem),
    homeSidebar,
  };
  const indexTemplate = theme.templates.index;
  // 首页模板为 defineHomeTemplate 定义体时：执行 load() 声明式取数并以 data 注入
  if (isHomeTemplateDefinition(indexTemplate)) {
    const cms = createCmsThemeDataApi(site, baseUrl);
    const data = indexTemplate.load ? await indexTemplate.load({ cms, site: base.site, baseUrl }) : {};
    const html = renderDoc(
      indexTemplate.Component as ComponentType<typeof props & { data: unknown }>,
      { ...props, data },
    );
    return { status: 200, html, kind: 'home' };
  }
  const html = renderDoc(indexTemplate, props);
  return { status: 200, html, kind: 'home' };
}

export async function renderCmsWidgetThemePreview(
  site: CmsSiteRow,
  widget: CmsResolvedWidget,
): Promise<string> {
  const result = await renderHomePage(site, `/__cms/${site.code}`, undefined, {
    homeSidebarOverride: widget,
    skipTakeover: true,
  });
  if (result.status !== 200) throw new Error('页面部件主题预览渲染失败');
  return stripCmsPreviewScripts(result.html);
}

async function loadChannelPathMap(siteId: number): Promise<Map<number, CmsUrlChannel>> {
  const rows = await db.select({ id: cmsChannels.id, path: cmsChannels.path, detailPathRule: cmsChannels.detailPathRule })
    .from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  return new Map(rows.map((r) => [r.id, { path: r.path, detailPathRule: r.detailPathRule }]));
}

/** 栏目在 map 中缺失时的兜底（站点根下不归档），避免生成 `undefined` 路径 */
const FALLBACK_URL_CHANNEL: CmsUrlChannel = { path: '', detailPathRule: 'none' };

/** 栏目标识 → id（页面搭建区块按 code 引用栏目，站点复制后无需重配） */
async function loadChannelCodeMap(siteId: number): Promise<Map<string, number>> {
  const rows = await db.select({ id: cmsChannels.id, code: cmsChannels.code }).from(cmsChannels).where(eq(cmsChannels.siteId, siteId));
  return new Map(rows.map((r) => [r.code, r.id]));
}

export async function renderChannelPage(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow, page = 1, templateOverride?: string | null): Promise<RenderResult> {
  const theme = getBuiltinThemeFallback(site.theme);
  if (channel.type === 'link') {
    const resolved = await resolveCmsLink(site.id, baseUrl, channel.linkUrl);
    return { status: 302, location: resolved?.url ?? `${baseUrl}/` };
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
    const props = {
      ...base,
      channel: toChannelInfo(channel, baseUrl),
      breadcrumbs,
      contentHtml: await resolveCmsResourcePayload(channel.pageContent ?? '', site.id),
      form: form ? {
        code: form.code,
        name: form.name,
        action: `/api/public/cms/forms/${site.code}/${form.code}`,
        returnUrl: channelUrl(baseUrl, channel.path),
        successMessage: form.successMessage ?? null,
        fields: (form.fields ?? []) as CmsFormField[],
        captcha: resolveCmsFormCaptcha(form, site),
      } : null,
    };
    const html = renderDoc(theme.templates.page, props);
    return { status: 200, html, kind: 'page' };
  }

  const { total, rows } = await listPublishedContents(site.id, channel.id, page, channel.pageSize);
  if (page > 1 && rows.length === 0) return renderNotFound(site, baseUrl, `/${channel.path}/index_${page}.html`);
  const resolvedList = resolveListComponent(site, channel, templateOverride);
  const resolveLink = await buildCmsLinkResolver(site.id, baseUrl, rows.map((r) => r.externalLink));
  // 详情 URL 必须按内容自己的主栏目算：列表会聚合副栏目内容（listPublishedContents 含
  // cms_content_channels），而详情页只在主栏目路径下可达（getPublishedContent 锁 channelId）。
  // 用当前栏目拼链接会让副栏目条目全部指向 404，也会给同一内容制造第二个 URL。
  const channelPathMap = await loadChannelPathMap(site.id);
  const listFieldDefs = await loadCmsListModelFieldDefs(rows.map((r) => r.modelId));
  const props = {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    items: rows.map((r) => toContentItem(r, baseUrl, channelPathMap.get(r.channelId) ?? FALLBACK_URL_CHANNEL, resolveLink, listFieldDefs)),
    pagination: buildPagination(baseUrl, channel.path, page, channel.pageSize, total),
  };
  const html = renderDoc(resolvedList.component, props);
  return { status: 200, html, kind: 'list' };
}

/** 详情页专属上下文片段：形态数据 + 正文分页 */
function buildDetailExtras(row: CmsContentRow, resolvedBody: string | null, baseUrl: string, channel: CmsUrlChannel, bodyPage: number) {
  const media = (row.mediaData ?? {}) as {
    images?: { url?: string; thumb?: string | null; caption?: string | null }[];
    mediaUrl?: string; poster?: string; duration?: string;
  };
  const albumImages = (Array.isArray(media.images) ? media.images : [])
    .filter((img) => typeof img?.url === 'string' && !!img.url && isValidCmsAssetUrl(img.url))
    .map((img) => ({
      url: img.url!,
      thumb: typeof img.thumb === 'string' && isValidCmsAssetUrl(img.thumb) ? img.thumb : null,
      caption: img.caption ?? null,
    }));

  const bodyPages = splitBodyPages(resolvedBody);
  const totalPages = bodyPages.length;
  const pageBody = bodyPages[Math.min(bodyPage, totalPages) - 1] ?? '';
  const bodyPagination = totalPages > 1 ? {
    page: bodyPage,
    totalPages,
    pages: bodyPages.map((_, i) => ({
      page: i + 1,
      url: contentUrl(baseUrl, channel, row, i + 1),
      current: i + 1 === bodyPage,
    })),
    prevUrl: bodyPage > 1 ? contentUrl(baseUrl, channel, row, bodyPage - 1) : null,
    nextUrl: bodyPage < totalPages ? contentUrl(baseUrl, channel, row, bodyPage + 1) : null,
  } : null;

  return {
    pageBody,
    totalPages,
    extras: {
      bodyPagination,
      attachments: (Array.isArray(row.attachments) ? row.attachments : []).filter((attachment) => {
        if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return false;
        const url = (attachment as unknown as Record<string, unknown>).url;
        return typeof url === 'string' && isValidCmsAssetUrl(url);
      }),
      albumImages,
      mediaUrl: typeof media.mediaUrl === 'string' && isValidCmsAssetUrl(media.mediaUrl) ? media.mediaUrl : null,
      mediaPoster: typeof media.poster === 'string' && isValidCmsAssetUrl(media.poster) ? media.poster : null,
      mediaDuration: media.duration ?? null,
    },
  };
}

/** 内容正文分页数（静态化生成 _n.html 时使用目标行的本地快照） */
export async function countContentBodyPages(row: Pick<CmsContentRow, 'body' | 'extend' | 'mappingSourceId'>, _siteId: number): Promise<number> {
  return splitBodyPages(row.body).length;
}

export async function renderDetailPage(site: CmsSiteRow, baseUrl: string, channel: CmsChannelRow, idOrSlug: string, bodyPage = 1, templateOverride?: string | null, canonicalGuardPath?: string | null): Promise<RenderResult> {
  const row = await getPublishedContent(site.id, channel.id, idOrSlug);
  if (!row) return renderNotFound(site, baseUrl, `/${channel.path}/${idOrSlug}.html`);
  if (row.externalLink?.trim()) {
    const resolved = await resolveCmsLink(site.id, baseUrl, row.externalLink);
    // 站内目标已删除/下线 → 该链接内容不再有可达目标，按 404 处理
    if (!resolved) return renderNotFound(site, baseUrl, `/${channel.path}/${idOrSlug}.html`);
    return { status: 302, location: resolved.url };
  }

  const canonicalPath = contentUrl('', channel, row, bodyPage);
  // 归档目录/自定义静态路径下，同一内容只允许在规范路径上可达，
  // 否则剥离归档段后的宽松匹配会让内容在任意目录名下重复可访问（SEO 重复内容 + 静态产物错位）
  if (canonicalGuardPath != null && `/${canonicalGuardPath.replace(/^\/+/, '')}` !== canonicalPath) {
    return renderNotFound(site, baseUrl, `/${canonicalGuardPath.replace(/^\/+/, '')}`);
  }
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
  const [base, breadcrumbs, adjacent, tags, linkWords, comments, relatedRows, resolved, modelFields] = await Promise.all([
    buildBaseContext(site, baseUrl, seo, row.id),
    buildBreadcrumbs(site, baseUrl, channel),
    getAdjacentContents(row),
    listContentTags(row.id),
    getEnabledLinkWords(site.id),
    listApprovedComments(row.id),
    listRelatedContents(row),
    resolveContentBodyExtend(row, site.id),
    buildCmsModelFieldValues(row.modelId, (row.extend ?? {}) as Record<string, unknown>),
  ]);
  const resolveLink = await buildCmsLinkResolver(site.id, baseUrl, [row.externalLink, ...linkWords.map((word) => word.url)]);
  const safeBody = sanitizeCmsHtml(resolved.body);
  const related = await buildRelatedLinks(baseUrl, relatedRows);
  const { pageBody, totalPages, extras } = buildDetailExtras(row, safeBody, baseUrl, channel, bodyPage);
  if (bodyPage > totalPages) return renderNotFound(site, baseUrl, `/${channel.path}/${idOrSlug}_${bodyPage}.html`);
  const detailTemplate = await resolveDetailComponent(site, channel, row.detailTemplate, row.modelId, templateOverride);
  const props = {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    content: {
      ...toContentItem(row, baseUrl, channel, resolveLink),
      body: applyInteractionMarkers(applyLinkWords(pageBody, linkWords, resolveLink), site.code, row.siteId),
      ...extras,
      extend: resolved.extend,
      modelFields,
      tags: tags.map((t) => ({ name: t.name, slug: t.slug, url: tagUrl(baseUrl, t.slug) })),
      prev: adjacent.prev ? { title: adjacent.prev.title, url: contentUrl(baseUrl, channel, adjacent.prev) } : null,
      next: adjacent.next ? { title: adjacent.next.title, url: contentUrl(baseUrl, channel, adjacent.next) } : null,
    },
    related,
    comments: comments.map((cm) => ({ id: cm.id, parentId: cm.parentId, nickname: cm.nickname, content: cm.content, likeCount: cm.likeCount, isMember: cm.memberId != null, createdAt: cm.createdAt })),
    commentForm: {
      action: '/api/public/cms/comments',
      contentId: row.id,
      returnUrl: contentUrl(baseUrl, channel, row),
      memberSubmitApi: `/api/member/cms/contents/${row.id}/comments`,
      captchaEnabled: isCaptchaEnabled(site),
    },
  };
  const html = renderDoc(detailTemplate.component, props);
  return { status: 200, html, kind: 'detail', contentId: row.id };
}

/** 相关文章行 → 前台链接（跨栏目取各自栏目路径） */
async function buildRelatedLinks(baseUrl: string, rows: CmsContentLinkRow[]): Promise<{ title: string; url: string }[]> {
  if (rows.length === 0) return [];
  const channelIds = [...new Set(rows.map((r) => r.channelId))];
  const channels = await db.select({ id: cmsChannels.id, path: cmsChannels.path, detailPathRule: cmsChannels.detailPathRule })
    .from(cmsChannels).where(inArray(cmsChannels.id, channelIds));
  const pathById = new Map(channels.map((ch) => [ch.id, { path: ch.path, detailPathRule: ch.detailPathRule }]));
  return rows
    .filter((r) => pathById.has(r.channelId))
    .map((r) => ({ title: r.title, url: contentUrl(baseUrl, pathById.get(r.channelId)!, r) }));
}

/**
 * 草稿预览渲染（签名链接访问，不校验发布状态）：
 * 复用详情页模板，顶部注入预览提示条；无缓存、无静态回写、无浏览计数。
 */
export async function renderContentPreviewPage(site: CmsSiteRow, baseUrl: string, contentId: number): Promise<RenderResult> {
  const [raw] = await db.select().from(cmsContents)
    .where(and(eq(cmsContents.id, contentId), eq(cmsContents.siteId, site.id), isNull(cmsContents.deletedAt)))
    .limit(1);
  if (!raw) return renderNotFound(site, baseUrl, `/preview/${contentId}`);
  // 草稿预览同样要把素材句柄还原为真实地址，否则预览页出现 cms-res:// 裸串
  const row = await resolveCmsContentRow(raw, site.id);
  const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, row.channelId)).limit(1);
  if (!channel) return renderNotFound(site, baseUrl, `/preview/${contentId}`);

  const seo = mergeSeo(site, {
    title: `【预览】${row.title}`,
    description: row.seoDescription ?? row.summary ?? undefined,
    pathForCanonical: contentUrl('', channel, row),
    ogTitle: row.title,
    ogImage: row.coverImage ?? undefined,
    ogImageAlt: row.socialImageAlt ?? undefined,
    ogType: 'article',
    articlePublishedTime: formatIso8601(row.publishedAt),
    articleModifiedTime: formatIso8601(row.updatedAt),
    articleAuthor: row.author ?? null,
    twitterCreator: row.twitterCreator ?? null,
  });
  const [base, breadcrumbs, tags, linkWords, resolved, previewModelFields] = await Promise.all([
    buildBaseContext(site, baseUrl, seo),
    buildBreadcrumbs(site, baseUrl, channel),
    listContentTags(row.id),
    getEnabledLinkWords(site.id),
    resolveContentBodyExtend(row, site.id),
    buildCmsModelFieldValues(row.modelId, (row.extend ?? {}) as Record<string, unknown>),
  ]);
  const previewTemplate = await resolveDetailComponent(site, channel, row.detailTemplate, row.modelId);
  const { pageBody: previewBody, extras: previewExtras } = buildDetailExtras(row, sanitizeCmsHtml(resolved.body), baseUrl, channel, 1);
  const resolveLink = await buildCmsLinkResolver(site.id, baseUrl, [row.externalLink, ...linkWords.map((word) => word.url)]);
  const props = {
    ...base,
    channel: toChannelInfo(channel, baseUrl),
    breadcrumbs,
    content: {
      ...toContentItem(row, baseUrl, channel, resolveLink),
      body: applyInteractionMarkers(applyLinkWords(previewBody, linkWords, resolveLink), site.code, row.siteId),
      ...previewExtras,
      extend: resolved.extend,
      modelFields: previewModelFields,
      tags: tags.map((t) => ({ name: t.name, slug: t.slug, url: tagUrl(baseUrl, t.slug) })),
      prev: null,
      next: null,
    },
    related: [],
    comments: [],
    commentForm: {
      action: '/api/public/cms/comments',
      contentId: row.id,
      returnUrl: contentUrl(baseUrl, channel, row),
      memberSubmitApi: `/api/member/cms/contents/${row.id}/comments`,
      captchaEnabled: isCaptchaEnabled(site),
    },
  };
  const html = renderDoc(previewTemplate.component, props);
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
  const theme = getBuiltinThemeFallback(site.theme);
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
  const props = {
    ...base,
    keyword,
    results: result.list,
    pagination: {
      page, pageSize, total: result.total, totalPages,
      prevUrl: page > 1 ? searchPageUrl(page - 1) : null,
      nextUrl: page < totalPages ? searchPageUrl(page + 1) : null,
      pages,
    },
  };
  const html = renderDoc(theme.templates.search, props);
  return { status: 200, html, kind: 'search' };
}

export async function renderNotFound(site: CmsSiteRow, baseUrl: string, path: string): Promise<RenderResult> {
  const theme = getBuiltinThemeFallback(site.theme);
  const seo = mergeSeo(site, { title: `页面不存在 - ${site.name}` });
  const base = await buildBaseContext(site, baseUrl, seo);
  const props = { ...base, path };
  const html = renderDoc(theme.templates.notFound, props);
  return { status: 404, html, kind: 'notFound' };
}

// ─── 前台统一互动问卷页（题目公开；提交与结果状态走 API）─────────────────────────
export async function renderInteractionPage(site: CmsSiteRow, baseUrl: string, code: string): Promise<RenderResult> {
  const { getPublicCmsInteractionByCode } = await import('./cms-interactions.service');
  const interaction = await getPublicCmsInteractionByCode(site.id, code);
  if (!interaction) return renderNotFound(site, baseUrl, `/interaction/${code}/`);
  const seo = mergeSeo(site, {
    title: `${interaction.title} - ${site.title?.trim() || site.name}`,
    description: interaction.description ?? undefined,
    pathForCanonical: `/interaction/${code}/`,
  });
  const base = await buildBaseContext(site, baseUrl, seo);
  const props = {
    ...base,
    breadcrumbs: [
      { name: '首页', url: `${baseUrl}/` },
      { name: interaction.title, url: `${baseUrl}/interaction/${code}/` },
    ],
    interaction: {
      id: interaction.id,
      code: interaction.code,
      kind: interaction.kind,
      title: interaction.title,
      description: interaction.description ?? null,
      participantScope: interaction.participantScope,
      repeatPolicy: interaction.repeatPolicy,
      resultVisibility: interaction.resultVisibility,
      captchaPolicy: interaction.captchaPolicy,
      questions: [...interaction.questions].sort((a, b) => a.sort - b.sort || a.id - b.id).map((question) => ({
        id: question.id,
        label: question.label,
        type: question.type,
        required: question.required,
        options: question.options ?? [],
        minChoices: question.minChoices,
        maxChoices: question.maxChoices,
        allowOther: question.allowOther,
        otherLabel: question.otherLabel ?? null,
        ratingMax: question.ratingMax,
        matrixRows: question.matrixRows ?? [],
        pageNo: question.pageNo,
        visibleWhen: question.visibleWhen ?? null,
      })),
    },
    submit: {
      stateApi: `/api/public/cms/interactions/${site.code}/${interaction.code}`,
      publicSubmitApi: `/api/public/cms/interactions/${site.code}/${interaction.code}/submit`,
      memberSubmitApi: `/api/member/cms/interactions/${interaction.id}/submit?siteId=${site.id}`,
    },
  };
  const html = renderDoc(
    resolveInteractionTemplate(getBuiltinThemeFallback(site.theme)),
    props,
  );
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
  const theme = getBuiltinThemeFallback(site.theme);
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
  const resolveLink = await buildCmsLinkResolver(site.id, baseUrl, rows.map((r) => r.externalLink));
  const tagFieldDefs = await loadCmsListModelFieldDefs(rows.map((r) => r.modelId));
  const props = {
    ...base,
    tag: { name: tag.name, slug: tag.slug, contentCount: tag.contentCount },
    breadcrumbs: [
      { name: '首页', url: `${baseUrl}/` },
      { name: `标签：${tag.name}`, url: tagUrl(baseUrl, slug) },
    ],
    items: rows.map((r) => toContentItem(r, baseUrl, channelPathMap.get(r.channelId) ?? FALLBACK_URL_CHANNEL, resolveLink, tagFieldDefs)),
    pagination: buildCmsPagination({
      page,
      pageSize,
      total,
      makeUrl: (p) => tagUrl(baseUrl, slug, p),
    }),
  };
  const html = renderDoc(theme.templates.tag, props);
  return { status: 200, html, kind: 'list' };
}

// ─── RSS 2.0 ─────────────────────────────────────────────────────────────────
function rssEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 生成站点或栏目 RSS（最新 50 条已发布内容） */
export async function generateRssXml(site: CmsSiteRow, channel?: CmsChannelRow | null): Promise<string> {
  const origin = siteOrigin(site) ?? '';
  const effectiveChannelIds = await getEffectivelyEnabledCmsChannelIds(site.id);
  if (channel && !effectiveChannelIds.has(channel.id)) {
    return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>';
  }
  const rows = await resolveCmsContentRows(await db.select(cmsContentListColumns).from(cmsContents)
    .where(and(
      eq(cmsContents.siteId, site.id),
      ...(channel ? [eq(cmsContents.channelId, channel.id)] : []),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.archivedAt),
      or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
      inArray(cmsContents.channelId, [...effectiveChannelIds]),
    ))
    .orderBy(desc(cmsContents.publishedAt), desc(cmsContents.id))
    .limit(50), site.id);
  const channelPathMap = await loadChannelPathMap(site.id);
  const resolveLink = await buildCmsLinkResolver(site.id, origin, rows.map((r) => r.externalLink));
  const feedTitle = channel ? `${channel.name} - ${site.name}` : (site.title?.trim() || site.name);
  const feedLink = channel ? `${origin}${channelUrl('', channel.path)}` : `${origin}/`;
  const items = rows.map((row) => {
    const rawLink = row.externalLink?.trim();
    const link = rawLink
      ? resolveLink(rawLink)?.url
      : `${origin}${contentUrl('', channelPathMap.get(row.channelId) ?? FALLBACK_URL_CHANNEL, row)}`;
    if (!link) return null;
    const description = listSummaryOf(row, 300);
    return [
      '    <item>',
      `      <title>${rssEscape(row.title)}</title>`,
      `      <link>${rssEscape(link)}</link>`,
      `      <guid isPermaLink="false">cms-content-${row.id}</guid>`,
      description ? `      <description>${rssEscape(stripHtml(description).slice(0, 300))}</description>` : '',
      row.publishedAt ? `      <pubDate>${new Date(row.publishedAt).toUTCString()}</pubDate>` : '',
      '    </item>',
    ].filter(Boolean).join('\n');
  }).filter((item): item is string => item !== null).join('\n');
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
export async function renderSitePath(
  site: CmsSiteRow,
  baseUrl: string,
  rawPath: string,
  templateOverride?: string | null,
  viewer?: { member?: boolean },
): Promise<RenderResult> {
  const cleaned = rawPath.replace(/^\/+|\/+$/g, '');
  if (cleaned === '' || cleaned === 'index.html') {
    return renderHomePage(site, baseUrl, viewer);
  }

  // 标签聚合页
  const tagMatch = /^tag\/([^/]+)(?:\/(?:index_(\d+)\.html)?)?$/.exec(cleaned);
  if (tagMatch) {
    return renderTagPage(site, baseUrl, tagMatch[1], Number(tagMatch[2] ?? 1));
  }

  // 可视化搭建页面 /p/{slug}/
  const pageMatch2 = /^p\/([a-z0-9-]+)(?:\/(?:index\.html)?)?$/.exec(cleaned);
  if (pageMatch2) {
    const { getPublishedPageBySlug } = await import('./cms-pages.service');
    const pageRow = await getPublishedPageBySlug(site.id, pageMatch2[1]);
    if (!pageRow) return renderNotFound(site, baseUrl, `/${cleaned}`);
    // 设了自定义路径后，默认路径跳转到规范 URL：既不产生重复内容，旧链接也不断
    if (pageRow.path) return { status: 302, location: customPageUrl(baseUrl, pageRow) };
    return renderCustomPage(site, baseUrl, pageRow, { member: viewer?.member });
  }

  // 搭建页自定义访问路径：置于栏目/详情解析之前，保证运营指定的路径确定性命中
  // （与栏目路径的冲突在保存时已双向拦截，此处不会误吞栏目）
  {
    const { getPublishedPageByPath } = await import('./cms-pages.service');
    const pageRow = await getPublishedPageByPath(site.id, cleaned);
    if (pageRow) return renderCustomPage(site, baseUrl, pageRow, { member: viewer?.member });
  }

  // Custom content paths cannot be recovered from a channel prefix. Resolve
  // them exactly before trying the conventional `{channel}/{slug}.html`
  // parser, including the `_N.html` body-page suffix.
  const customContent = await findPublishedContentByStaticPath(site.id, cleaned);
  if (customContent) {
    const [channel] = await db.select().from(cmsChannels).where(and(
      eq(cmsChannels.id, customContent.content.channelId),
      eq(cmsChannels.siteId, site.id),
      eq(cmsChannels.status, 'enabled'),
    )).limit(1);
    if (channel) {
      return renderDetailPage(
        site,
        baseUrl,
        channel,
        String(customContent.content.slug ?? customContent.content.id),
        customContent.bodyPage,
        templateOverride,
        cleaned,
      );
    }
  }

  // 前台统一互动问卷页 /interaction/{code}/
  const interactionMatch = /^interaction\/([a-z0-9-]+)(?:\/(?:index\.html)?)?$/.exec(cleaned);
  if (interactionMatch) {
    return renderInteractionPage(site, baseUrl, interactionMatch[1]);
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
      return renderChannelPage(site, baseUrl, channel, Number(pageMatch[1]), templateOverride);
    }
    if (!dir) return renderNotFound(site, baseUrl, `/${cleaned}`);
    // 详情页目录可能带归档段（如 news/2026/7/5），栏目路径按最长前缀匹配后逐级剥离；
    // 真实存在同名子栏目时先命中子栏目，语义正确。
    const detail = await findChannelByPathPrefix(site.id, dir);
    if (!detail) return renderNotFound(site, baseUrl, `/${cleaned}`);
    const fileBase = file.slice(0, -'.html'.length);
    // 正文多页：{idOrSlug}_{n}.html（slug 不含下划线，无歧义）
    const bodyPageMatch = /^(.+)_(\d+)$/.exec(fileBase);
    if (bodyPageMatch && Number(bodyPageMatch[2]) >= 2) {
      return renderDetailPage(site, baseUrl, detail, bodyPageMatch[1], Number(bodyPageMatch[2]), templateOverride, cleaned);
    }
    return renderDetailPage(site, baseUrl, detail, fileBase, 1, templateOverride, cleaned);
  }

  const channel = await findChannelByPath(site.id, cleaned);
  if (!channel) return renderNotFound(site, baseUrl, `/${cleaned}`);
  return renderChannelPage(site, baseUrl, channel, 1, templateOverride);
}
