import { Hono } from 'hono';
import type { Context } from 'hono';
import { CMS_PREVIEW_PREFIX } from '@zenith/shared';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import type { CmsSiteRow } from '../../db/schema';
import { resolveSiteByHost, resolveSiteByCode } from '../../services/cms/cms-sites.service';
import {
  renderSitePath, renderSearchPage, type RenderResult,
} from '../../services/cms/cms-render.service';
import { readStaticFile, writeStaticFile, generateSitemapXml, buildRobotsTxt } from '../../services/cms/cms-static.service';
import { increaseViewCount } from '../../services/cms/cms-contents.service';

const PAGE_CACHE_PREFIX = `${config.redis.keyPrefix}cms:page:`;
const SITEMAP_CACHE_PREFIX = `${config.redis.keyPrefix}cms:sitemap:`;
const PAGE_CACHE_TTL_SECONDS = 60;
const SITEMAP_CACHE_TTL_SECONDS = 600;

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' } as const;

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
        return c.newResponse(cached, 200, { ...HTML_HEADERS, 'X-Cms-Cache': 'static' });
      }
    }

    // dynamic 模式：Redis 页面缓存
    const cacheKey = `${PAGE_CACHE_PREFIX}${site.id}:${sitePath}`;
    if (!isPreview && site.staticMode === 'dynamic') {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) {
        return c.newResponse(cached, 200, { ...HTML_HEADERS, 'X-Cms-Cache': 'redis' });
      }
    }

    // SSR 渲染
    const result = await renderSitePath(site, baseUrl, sitePath);
    if (result.status === 200) {
      if (result.kind === 'detail' && result.contentId && !isPreview) {
        void increaseViewCount(result.contentId).catch(() => undefined);
      }
      if (!isPreview && site.staticMode === 'hybrid') {
        // 混合模式：miss 即渲染并回写，下次直接命中静态文件
        void writeStaticFile(site.code, sitePath, result.html).catch((err) => {
          logger.error(`[CMS] 静态回写失败 site=${site.code} path=${sitePath}`, err);
        });
      }
      if (!isPreview && site.staticMode === 'dynamic') {
        redis.setex(cacheKey, PAGE_CACHE_TTL_SECONDS, result.html).catch(() => undefined);
      }
    }
    return respond(c, result);
  });

  return app;
}
