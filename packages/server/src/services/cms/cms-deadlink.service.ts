import { createRequire } from 'node:module';
import { eq, and, gt, isNull, or } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents, cmsFriendLinks, cmsTags, cmsPages } from '../../db/schema';
import { httpRequest } from '../../lib/http-client';
import { registerTaskHandler } from '../../lib/task-center';
import { findChannelByPath } from './cms-render.service';
import { getPublishedContent } from './cms-contents.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { mapWithConcurrency } from '../../lib/concurrency';
import { findPublishedContentByStaticPath } from './cms-contents-query.service';

/**
 * 死链检测（任务中心执行）：
 * 扫描站点已发布内容正文中的链接与友情链接，站内链接查库校验，
 * 外链 HEAD 探测（限量防滥用），行级明细输出坏链报告。
 */

interface LinkItem {
  url: string;
  source: string;
}

const LINK_CHECK_BATCH = 25;

// 惰性加载：cheerio 模块图大（实测 ~3s），仅在执行死链检测任务时加载
const require = createRequire(import.meta.url);
const load: typeof import('cheerio')['load'] = (...args: Parameters<typeof import('cheerio')['load']>) =>
  (require('cheerio') as typeof import('cheerio')).load(...args);

async function collectSiteLinks(siteId: number): Promise<LinkItem[]> {
  const links: LinkItem[] = [];
  let afterId = 0;
  for (;;) {
  const contents = await db.select({ id: cmsContents.id, title: cmsContents.title, body: cmsContents.body })
    .from(cmsContents)
    .where(and(
      eq(cmsContents.siteId, siteId),
      gt(cmsContents.id, afterId),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
      isNull(cmsContents.archivedAt),
      or(isNull(cmsContents.expireAt), gt(cmsContents.expireAt, new Date())),
    )).orderBy(cmsContents.id).limit(200);
  if (!contents.length) break;
  for (const row of contents) {
    if (!row.body) continue;
    const $ = load(row.body);
    $('a[href]').each((_, el) => {
      const href = String($(el).attr('href') ?? '').trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      links.push({ url: href, source: `内容《${row.title}》` });
    });
  }
  afterId = contents[contents.length - 1].id;
  }
  const friendLinks = await db.select().from(cmsFriendLinks)
    .where(and(eq(cmsFriendLinks.siteId, siteId), eq(cmsFriendLinks.status, 'enabled')));
  for (const l of friendLinks) {
    links.push({ url: l.url, source: `友情链接「${l.name}」` });
  }
  // 去重（同 URL 保留首个来源）
  const seen = new Map<string, LinkItem>();
  for (const l of links) {
    if (!seen.has(l.url)) seen.set(l.url, l);
  }
  return [...seen.values()];
}

/** 站内链接校验：解析栏目页/详情页路径是否存在 */
async function checkInternalLink(siteId: number, path: string): Promise<boolean> {
  const cleaned = path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
  if (cleaned === '' || cleaned === 'index.html' || cleaned === 'search' || cleaned === 'rss.xml' || cleaned === 'sitemap.xml' || cleaned === 'robots.txt') return true;
  if (cleaned.startsWith('tag/')) {
    const [tag] = await db.select({ id: cmsTags.id }).from(cmsTags).where(and(eq(cmsTags.siteId, siteId), eq(cmsTags.slug, cleaned.split('/')[1] ?? ''))).limit(1);
    return Boolean(tag);
  }
  const [page] = await db.select({ id: cmsPages.id }).from(cmsPages).where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.status, 'enabled'), or(eq(cmsPages.path, cleaned), eq(cmsPages.slug, cleaned.replace(/^p\//, ''))))).limit(1);
  if (page || await findPublishedContentByStaticPath(siteId, cleaned)) return true;
  if (cleaned.endsWith('.html')) {
    const segments = cleaned.split('/');
    const file = segments.pop()!;
    const dir = segments.join('/');
    if (/^index_\d+\.html$/.test(file)) {
      return !!(dir && await findChannelByPath(siteId, dir));
    }
    if (!dir) return false;
    const channel = await findChannelByPath(siteId, dir);
    if (!channel) return false;
    return !!(await getPublishedContent(siteId, channel.id, file.slice(0, -'.html'.length)));
  }
  return !!(await findChannelByPath(siteId, cleaned));
}

async function checkExternalLink(url: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await httpRequest(url, { method: 'HEAD', timeout: 10_000, ssrfProtection: true });
    if (res.status === 405 || res.status === 501) {
      // 部分站点不支持 HEAD，回退 GET
      const getRes = await httpRequest(url, { method: 'GET', timeout: 10_000, ssrfProtection: true });
      return { ok: getRes.status < 400, status: getRes.status };
    }
    return { ok: res.status < 400, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

export function registerCmsDeadlinkTaskHandler(): void {
  registerTaskHandler({
    taskType: 'cms-deadlink-check',
    title: 'CMS 死链检测',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 3,
    async run(ctx) {
      const payload = ctx.payload as { siteId?: number };
      const siteId = Number(payload.siteId);
      if (!siteId) throw new Error('缺少 siteId 参数');
      await ensureCmsSiteExists(siteId);
      await assertSiteAccess(siteId);
      await assertAllCmsSiteChannelsAccess(siteId);

      const links = await collectSiteLinks(siteId);
      const internal = links.filter((l) => l.url.startsWith('/'));
      const external = links.filter((l) => /^https?:\/\//.test(l.url));
      const total = internal.length + external.length;
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let broken = Number(ctx.checkpoint?.broken ?? 0);
      const cursor = typeof ctx.checkpoint?.cursor === 'string' ? ctx.checkpoint.cursor : '';
      const pending = [...internal, ...external].sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0).filter((link) => link.url > cursor);
      for (let index = 0; index < pending.length; index += LINK_CHECK_BATCH) {
        const batch = pending.slice(index, index + LINK_CHECK_BATCH);
        const results = await mapWithConcurrency(batch, 5, async (link) => {
          const result = link.url.startsWith('/') ? { ok: await checkInternalLink(siteId, link.url), status: null } : await checkExternalLink(link.url);
          return { link, result };
        });
        for (const { link, result } of results) {
          processed += 1;
          if (!result.ok) broken += 1;
          await ctx.reportItems([{ key: link.url.slice(0, 200), label: link.source, status: result.ok ? 'success' : 'failed', message: result.ok ? '可访问' : result.status ? `响应 ${result.status}` : '目标不可访问', data: { url: link.url } }]);
        }
        const nextCursor = batch[batch.length - 1].url;
        const { cancelRequested } = await ctx.progress({ processed, total, checkpoint: { processed, broken, cursor: nextCursor }, note: `已检测 ${processed}/${total}，坏链 ${broken}` });
        if (cancelRequested) return { processed, broken };
      }

      return { processed, broken, internal: internal.length, external: external.length };
    },
  });
}
