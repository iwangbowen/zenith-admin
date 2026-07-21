import { load } from 'cheerio';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents, cmsFriendLinks } from '../../db/schema';
import { httpRequest } from '../../lib/http-client';
import { registerTaskHandler } from '../../lib/task-center';
import { findChannelByPath } from './cms-render.service';
import { getPublishedContent } from './cms-contents.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';

/**
 * 死链检测（任务中心执行）：
 * 扫描站点已发布内容正文中的链接与友情链接，站内链接查库校验，
 * 外链 HEAD 探测（限量防滥用），行级明细输出坏链报告。
 */

interface LinkItem {
  url: string;
  source: string;
}

const EXTERNAL_LINK_CAP = 200;

async function collectSiteLinks(siteId: number): Promise<LinkItem[]> {
  const links: LinkItem[] = [];
  const contents = await db.select({ id: cmsContents.id, title: cmsContents.title, body: cmsContents.body })
    .from(cmsContents)
    .where(and(eq(cmsContents.siteId, siteId), eq(cmsContents.status, 'published'), isNull(cmsContents.deletedAt)));
  for (const row of contents) {
    if (!row.body) continue;
    const $ = load(row.body);
    $('a[href]').each((_, el) => {
      const href = String($(el).attr('href') ?? '').trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      links.push({ url: href, source: `内容《${row.title}》` });
    });
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
  if (cleaned.startsWith('tag/')) return true; // 标签页由渲染层兜底 404，不视为死链
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
    maxAttempts: 1,
    async run(ctx) {
      const payload = ctx.payload as { siteId?: number };
      const siteId = Number(payload.siteId);
      if (!siteId) throw new Error('缺少 siteId 参数');
      await ensureCmsSiteExists(siteId);
      await assertSiteAccess(siteId);
      await assertAllCmsSiteChannelsAccess(siteId);

      const links = await collectSiteLinks(siteId);
      const internal = links.filter((l) => l.url.startsWith('/'));
      const external = links.filter((l) => /^https?:\/\//.test(l.url)).slice(0, EXTERNAL_LINK_CAP);
      const total = internal.length + external.length;
      let processed = 0;
      let broken = 0;

      for (const link of internal) {
        const ok = await checkInternalLink(siteId, link.url);
        processed += 1;
        if (!ok) {
          broken += 1;
          await ctx.reportItems([{ key: link.url.slice(0, 200), label: link.source, status: 'failed', message: '站内链接目标不存在' }]);
        }
        const { cancelRequested } = await ctx.progress({ processed, total, note: `已检测 ${processed}/${total}，坏链 ${broken}` });
        if (cancelRequested) return { processed, broken };
      }

      for (const link of external) {
        const result = await checkExternalLink(link.url);
        processed += 1;
        if (!result.ok) {
          broken += 1;
          await ctx.reportItems([{
            key: link.url.slice(0, 200),
            label: link.source,
            status: 'failed',
            message: result.status ? `外链响应 ${result.status}` : '外链无法访问',
          }]);
        }
        const { cancelRequested } = await ctx.progress({ processed, total, note: `已检测 ${processed}/${total}，坏链 ${broken}` });
        if (cancelRequested) return { processed, broken };
      }

      return { processed, broken, internal: internal.length, external: external.length };
    },
  });
}
