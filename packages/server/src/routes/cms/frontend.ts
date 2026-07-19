import { Hono } from 'hono';
import type { Context } from 'hono';
import { CMS_PREVIEW_PREFIX } from '@zenith/shared';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import type { CmsSiteRow } from '../../db/schema';
import { resolveSiteByHost, resolveSiteByCode } from '../../services/cms/cms-sites.service';
import { resolveRedirect } from '../../services/cms/cms-redirects.service';
import {
  renderSitePath, renderSearchPage, renderContentPreviewPage, type RenderResult,
} from '../../services/cms/cms-render.service';
import { verifyContentPreviewToken } from '../../services/cms/cms-preview.service';
import { readStaticFile, writeStaticFile, generateSitemapXml, buildRobotsTxt } from '../../services/cms/cms-static.service';
import { generateRssXml, findChannelByPath } from '../../services/cms/cms-render.service';

const PAGE_CACHE_PREFIX = `${config.redis.keyPrefix}cms:page:`;
const SITEMAP_CACHE_PREFIX = `${config.redis.keyPrefix}cms:sitemap:`;
const SITEMAP_CACHE_TTL_SECONDS = 600;

/** dynamic 模式 Redis 页面缓存 TTL：按页面类型分级（详情最长，搜索最短） */
const PAGE_CACHE_TTL_BY_KIND: Record<string, number> = {
  home: 300,
  list: 180,
  page: 300,
  detail: 600,
};
const PAGE_CACHE_TTL_DEFAULT_SECONDS = 60;

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' } as const;

/** 弱 ETag（FNV-1a 哈希，CDN/浏览器协商缓存用） */
function weakEtag(html: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${(hash >>> 0).toString(16)}-${html.length.toString(16)}"`;
}

/** HTML 响应：附带 ETag/Cache-Control，If-None-Match 命中返回 304 */
function htmlResponse(c: Context, html: string, cacheSeconds: number, extraHeaders?: Record<string, string>) {
  const etag = weakEtag(html);
  if (c.req.header('if-none-match') === etag) {
    return c.newResponse(null, 304, { ETag: etag });
  }
  return c.newResponse(html, 200, {
    ...HTML_HEADERS,
    ETag: etag,
    'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-cache',
    ...extraHeaders,
  });
}

interface ResolvedTarget {
  site: CmsSiteRow;
  /** 站内相对路径（不含预览前缀） */
  sitePath: string;
  /** 渲染链接前缀：正式域名 ''，预览 /__cms/{code} */
  baseUrl: string;
  isPreview: boolean;
}

async function resolveTarget(host: string | undefined, pathname: string): Promise<ResolvedTarget | null> {
  if (pathname.startsWith(`${CMS_PREVIEW_PREFIX}/`)) {
    const rest = pathname.slice(CMS_PREVIEW_PREFIX.length + 1);
    const [code, ...restSegments] = rest.split('/');
    if (!code) return null;
    const site = await resolveSiteByCode(code);
    if (!site) return null;
    return {
      site,
      sitePath: restSegments.join('/'),
      baseUrl: `${CMS_PREVIEW_PREFIX}/${code}`,
      isPreview: true,
    };
  }
  const site = await resolveSiteByHost(host);
  if (!site) return null;
  return { site, sitePath: pathname.replace(/^\/+/, ''), baseUrl: '', isPreview: false };
}

function respond(c: Context, result: RenderResult) {
  if (result.status === 302) return c.redirect(result.location, 302);
  return c.newResponse(result.html, result.status, { ...HTML_HEADERS });
}

/**
 * CMS 前台渲染路由（挂载在所有 /api 路由之后的根路径兜底）：
 * 1. Host / 预览前缀匹配站点；2. 静态文件命中直返；3. miss → SSR 渲染；
 * 4. hybrid 站点渲染后回写静态文件；dynamic 站点走 Redis 页面缓存。
 */
export function createCmsFrontendRoutes(): Hono {
  const app = new Hono();

  app.get('*', async (c, next) => {
    const url = new URL(c.req.url);
    const pathname = decodeURIComponent(url.pathname);
    // 不接管 API / 指标 / 文档等既有路径（挂载在最后，理论上到不了这里，双保险）
    if (pathname.startsWith('/api/') || pathname === '/api' || pathname === '/metrics') {
      return next();
    }

    const target = await resolveTarget(c.req.header('host'), pathname);
    if (!target) return next();
    const { site, sitePath, baseUrl, isPreview } = target;

    // 301/302 重定向规则（优先级最高）
    const redirect = await resolveRedirect(site.id, `/${sitePath}`);
    if (redirect) {
      const location = redirect.toUrl.startsWith('/') ? `${baseUrl}${redirect.toUrl}` : redirect.toUrl;
      return c.redirect(location, redirect.type === 302 ? 302 : 301);
    }

    // IndexNow key 校验文件（{key}.txt，配置于站点 settings.indexNowKey）
    const indexNowKey = (site.settings as Record<string, unknown> | null)?.indexNowKey;
    if (typeof indexNowKey === 'string' && indexNowKey && sitePath === `${indexNowKey}.txt`) {
      return c.text(indexNowKey);
    }

    // robots.txt / sitemap.xml（始终动态生成，保证实时；sitemap 带 Redis 缓存）
    if (sitePath === 'robots.txt') {
      return c.text(buildRobotsTxt(site));
    }
    if (sitePath === 'sitemap.xml') {
      const cacheKey = `${SITEMAP_CACHE_PREFIX}${site.id}`;
      let xml = await redis.get(cacheKey).catch(() => null);
      if (!xml) {
        xml = await generateSitemapXml(site);
        redis.setex(cacheKey, SITEMAP_CACHE_TTL_SECONDS, xml).catch(() => undefined);
      }
      return c.newResponse(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
    }

    // RSS：站点级 /rss.xml 与栏目级 /{channelPath}/rss.xml
    if (sitePath === 'rss.xml' || sitePath.endsWith('/rss.xml')) {
      const channelPath = sitePath === 'rss.xml' ? null : sitePath.slice(0, -'/rss.xml'.length);
      const channel = channelPath ? await findChannelByPath(site.id, channelPath) : null;
      if (channelPath && !channel) return next();
      const cacheKey = `${SITEMAP_CACHE_PREFIX}rss:${site.id}:${channelPath ?? ''}`;
      let xml = await redis.get(cacheKey).catch(() => null);
      if (!xml) {
        xml = await generateRssXml(site, channel);
        redis.setex(cacheKey, SITEMAP_CACHE_TTL_SECONDS, xml).catch(() => undefined);
      }
      return c.newResponse(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }

    // 草稿预览（签名临时链接，未发布内容可分享给审核人查看；无缓存、不回写静态）
    const previewMatch = /^preview\/(\d+)$/.exec(sitePath.replace(/\/+$/, ''));
    if (previewMatch) {
      const contentId = Number(previewMatch[1]);
      const exp = Number(c.req.query('exp'));
      const sig = c.req.query('sig') ?? '';
      if (!verifyContentPreviewToken(contentId, exp, sig)) {
        return c.text('预览链接无效或已过期', 403);
      }
      const result = await renderContentPreviewPage(site, baseUrl, contentId);
      return respond(c, result);
    }

    // 搜索页：永远动态渲染（不静态化、不缓存）
    if (sitePath === 'search' || sitePath === 'search/') {
      const keyword = (c.req.query('q') ?? '').trim().slice(0, 64);
      const page = Math.max(1, Number(c.req.query('page')) || 1);
      const result = await renderSearchPage(site, baseUrl, keyword, page);
      return respond(c, result);
    }

    // 静态文件命中（预览模式跳过，保证后台改动即时可见）
    if (!isPreview && site.staticMode !== 'dynamic' && (sitePath === '' || sitePath.endsWith('/') || sitePath.endsWith('.html'))) {
      const cached = await readStaticFile(site.code, sitePath);
      if (cached !== null) {
        return htmlResponse(c, cached, PAGE_CACHE_TTL_DEFAULT_SECONDS, { 'X-Cms-Cache': 'static' });
      }
    }

    // dynamic 模式：Redis 页面缓存
    const cacheKey = `${PAGE_CACHE_PREFIX}${site.id}:${sitePath}`;
    if (!isPreview && site.staticMode === 'dynamic') {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        return htmlResponse(c, cached, PAGE_CACHE_TTL_DEFAULT_SECONDS, { 'X-Cms-Cache': 'redis' });
      }
    }

    // SSR 渲染
    const result = await renderSitePath(site, baseUrl, sitePath);
    if (result.status === 200) {
      const ttl = PAGE_CACHE_TTL_BY_KIND[result.kind] ?? PAGE_CACHE_TTL_DEFAULT_SECONDS;
      if (!isPreview && site.staticMode === 'hybrid') {
        // 混合模式：miss 即渲染并回写，下次直接命中静态文件
        void writeStaticFile(site.code, sitePath, result.html).catch((err) => {
          logger.error(`[CMS] 静态回写失败 site=${site.code} path=${sitePath}`, err);
        });
      }
      if (!isPreview && site.staticMode === 'dynamic') {
        redis.setex(cacheKey, ttl, result.html).catch(() => undefined);
      }
      if (!isPreview) {
        return htmlResponse(c, result.html, ttl);
      }
    }
    return respond(c, result);
  });

  return app;
}
