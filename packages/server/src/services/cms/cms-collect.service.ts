/**
 * 采集中心：列表页翻页 + CSS 选择器抽取 → 清洗 → 可选图片本地化 → 入库（草稿或直接发布）。
 * 执行走任务中心（进度/取消/行级明细）；URL 级去重防重复采集；全程 http-client SSRF 防护。
 */
import { load } from 'cheerio';
import { and, desc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsCollectRules, cmsCollectItems, cmsContents, cmsChannels } from '../../db/schema';
import type { CmsCollectRuleRow } from '../../db/schema';
import { httpRequest } from '../../lib/http-client';
import { registerTaskHandler } from '../../lib/task-center';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { buildManagedFileProxyUrl } from '../../lib/file-storage';
import { buildSearchVector } from './cms-search.service';
import { assertSiteAccess } from './cms-sites.service';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCollectRule(row: CmsCollectRuleRow, channelName?: string | null) {
  return {
    id: row.id,
    siteId: row.siteId,
    channelId: row.channelId,
    channelName: channelName ?? null,
    name: row.name,
    listUrl: row.listUrl,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    listSelector: row.listSelector,
    titleSelector: row.titleSelector,
    bodySelector: row.bodySelector,
    summarySelector: row.summarySelector ?? null,
    coverSelector: row.coverSelector ?? null,
    removeSelectors: row.removeSelectors ?? [],
    autoPublish: row.autoPublish,
    localizeImages: row.localizeImages,
    maxItems: row.maxItems,
    status: row.status,
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 规则 CRUD ────────────────────────────────────────────────────────────────
export async function listCollectRules(params: { page: number; pageSize: number; siteId: number; keyword?: string }) {
  const conds = [eq(cmsCollectRules.siteId, params.siteId)];
  if (params.keyword) conds.push(sql`${cmsCollectRules.name} ILIKE ${`%${escapeLike(params.keyword)}%`}`);
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(cmsCollectRules, where),
    withPagination(
      db.select({ rule: cmsCollectRules, channelName: cmsChannels.name })
        .from(cmsCollectRules)
        .leftJoin(cmsChannels, eq(cmsCollectRules.channelId, cmsChannels.id))
        .where(where)
        .orderBy(desc(cmsCollectRules.id))
        .$dynamic(),
      params.page, params.pageSize,
    ),
  ]);
  return { list: rows.map((r) => mapCollectRule(r.rule, r.channelName)), total, page: params.page, pageSize: params.pageSize };
}

async function ensureRuleChannel(siteId: number, channelId: number) {
  const [channel] = await db.select().from(cmsChannels)
    .where(and(eq(cmsChannels.id, channelId), eq(cmsChannels.siteId, siteId))).limit(1);
  if (!channel || channel.type !== 'list') throw new HTTPException(400, { message: '目标栏目必须是本站点的列表型栏目' });
  return channel;
}

export interface CollectRuleInput {
  siteId: number;
  channelId: number;
  name: string;
  listUrl: string;
  pageStart?: number;
  pageEnd?: number;
  listSelector: string;
  titleSelector: string;
  bodySelector: string;
  summarySelector?: string | null;
  coverSelector?: string | null;
  removeSelectors?: string[];
  autoPublish?: boolean;
  localizeImages?: boolean;
  maxItems?: number;
  status?: 'enabled' | 'disabled';
  remark?: string | null;
}

export async function createCollectRule(input: CollectRuleInput) {
  await assertSiteAccess(input.siteId);
  await ensureRuleChannel(input.siteId, input.channelId);
  const [created] = await db.insert(cmsCollectRules).values(input).returning();
  return mapCollectRule(created);
}

export async function updateCollectRule(id: number, input: Partial<CollectRuleInput>) {
  const [current] = await db.select().from(cmsCollectRules).where(eq(cmsCollectRules.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '采集规则不存在' });
  await assertSiteAccess(current.siteId);
  if (input.channelId && input.channelId !== current.channelId) {
    await ensureRuleChannel(current.siteId, input.channelId);
  }
  const { siteId: _ignored, ...rest } = input;
  const [updated] = await db.update(cmsCollectRules).set(rest).where(eq(cmsCollectRules.id, id)).returning();
  return mapCollectRule(updated);
}

export async function deleteCollectRule(id: number) {
  const [current] = await db.select().from(cmsCollectRules).where(eq(cmsCollectRules.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '采集规则不存在' });
  await assertSiteAccess(current.siteId);
  await db.delete(cmsCollectRules).where(eq(cmsCollectRules.id, id));
}

export async function ensureCollectRuleRunnable(id: number): Promise<CmsCollectRuleRow> {
  const [rule] = await db.select().from(cmsCollectRules).where(eq(cmsCollectRules.id, id)).limit(1);
  if (!rule) throw new HTTPException(404, { message: '采集规则不存在' });
  await assertSiteAccess(rule.siteId);
  if (rule.status !== 'enabled') throw new HTTPException(400, { message: '规则已停用' });
  return rule;
}

// ─── 采集明细 ─────────────────────────────────────────────────────────────────
export async function listCollectItems(params: { page: number; pageSize: number; ruleId: number; status?: string }) {
  const conds = [eq(cmsCollectItems.ruleId, params.ruleId)];
  if (params.status) conds.push(eq(cmsCollectItems.status, params.status as 'success' | 'skipped' | 'failed'));
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(cmsCollectItems, where),
    withPagination(
      db.select().from(cmsCollectItems).where(where).orderBy(desc(cmsCollectItems.id)).$dynamic(),
      params.page, params.pageSize,
    ),
  ]);
  return {
    list: rows.map((r) => ({
      id: r.id, ruleId: r.ruleId, url: r.url, title: r.title ?? null,
      status: r.status, contentId: r.contentId ?? null, error: r.error ?? null,
      createdAt: formatDateTime(r.createdAt),
    })),
    total, page: params.page, pageSize: params.pageSize,
  };
}

// ─── 抓取执行 ─────────────────────────────────────────────────────────────────
const FETCH_TIMEOUT = 15_000;
const IMAGE_CAP_PER_ARTICLE = 10;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 内网源站白名单（逗号分隔 hostname），用于企业内网系统作为采集源的场景 */
function collectSsrfAllowlist(): string[] {
  return (process.env.CMS_COLLECT_SSRF_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function fetchHtml(url: string): Promise<string> {
  const res = await httpRequest(url, { method: 'GET', timeout: FETCH_TIMEOUT, ssrfProtection: true, ssrfAllowlist: collectSsrfAllowlist() });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function absolutize(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** 列表页抽取条目链接（去重、绝对化、限量） */
export async function extractListLinks(rule: Pick<CmsCollectRuleRow, 'listUrl' | 'pageStart' | 'pageEnd' | 'listSelector' | 'maxItems'>): Promise<string[]> {
  const links: string[] = [];
  const seen = new Set<string>();
  const hasPagePlaceholder = rule.listUrl.includes('{page}');
  const pages = hasPagePlaceholder
    ? Array.from({ length: Math.max(1, rule.pageEnd - rule.pageStart + 1) }, (_, i) => rule.pageStart + i)
    : [rule.pageStart];
  for (const page of pages) {
    if (links.length >= rule.maxItems) break;
    const url = hasPagePlaceholder ? rule.listUrl.replaceAll('{page}', String(page)) : rule.listUrl;
    const html = await fetchHtml(url);
    const $ = load(html);
    $(rule.listSelector).each((_, el) => {
      if (links.length >= rule.maxItems) return;
      const node = $(el);
      const href = node.is('a') ? node.attr('href') : node.find('a').first().attr('href');
      if (!href) return;
      const abs = absolutize(url, String(href).trim());
      if (!abs || !/^https?:\/\//.test(abs) || seen.has(abs)) return;
      seen.add(abs);
      links.push(abs);
    });
  }
  return links;
}

interface ExtractedArticle {
  title: string;
  summary: string | null;
  coverImage: string | null;
  bodyHtml: string;
}

/** 详情页按选择器抽取并清洗 */
export function extractArticle(html: string, pageUrl: string, rule: Pick<CmsCollectRuleRow, 'titleSelector' | 'bodySelector' | 'summarySelector' | 'coverSelector' | 'removeSelectors'>): ExtractedArticle {
  const $ = load(html);
  const title = $(rule.titleSelector).first().text().trim();
  if (!title) throw new Error('未匹配到标题');
  const bodyNode = $(rule.bodySelector).first();
  if (bodyNode.length === 0) throw new Error('未匹配到正文');
  for (const selector of rule.removeSelectors ?? []) {
    bodyNode.find(selector).remove();
  }
  bodyNode.find('script, style, iframe, form').remove();
  // 图片/链接绝对化，便于后续本地化与前台展示
  bodyNode.find('img[src]').each((_, el) => {
    const abs = absolutize(pageUrl, String($(el).attr('src')));
    if (abs) $(el).attr('src', abs);
  });
  bodyNode.find('a[href]').each((_, el) => {
    const abs = absolutize(pageUrl, String($(el).attr('href')));
    if (abs) $(el).attr('href', abs);
  });
  const summary = rule.summarySelector ? $(rule.summarySelector).first().text().trim().slice(0, 500) || null : null;
  let coverImage: string | null = null;
  if (rule.coverSelector) {
    const coverNode = $(rule.coverSelector).first();
    const src = coverNode.is('img') ? coverNode.attr('src') : coverNode.find('img').first().attr('src');
    coverImage = src ? absolutize(pageUrl, String(src)) : null;
  }
  return { title: title.slice(0, 255), summary, coverImage, bodyHtml: bodyNode.html() ?? '' };
}

/** 正文远程图片本地化：下载 → 文件中心 → 替换 src（失败保留原地址） */
async function localizeArticleImages(bodyHtml: string, createdBy: number): Promise<string> {
  const { saveGeneratedManagedFile } = await import('../files/files.service');
  const $ = load(bodyHtml, null, false);
  const imgs = $('img[src^="http"]').toArray().slice(0, IMAGE_CAP_PER_ARTICLE);
  for (const el of imgs) {
    const src = String($(el).attr('src'));
    try {
      const res = await httpRequest(src, { method: 'GET', timeout: FETCH_TIMEOUT, ssrfProtection: true, ssrfAllowlist: collectSsrfAllowlist() });
      if (res.status >= 400) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES) continue;
      const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      if (!mime.startsWith('image/')) continue;
      const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg';
      const saved = await saveGeneratedManagedFile({
        buffer: buf,
        filename: `collect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
        mimeType: mime,
        tenantId: null,
        createdBy,
      });
      $(el).attr('src', buildManagedFileProxyUrl(saved.id));
    } catch {
      // 单图失败不影响整篇
    }
  }
  return $.html();
}

// ─── 任务中心 handler ─────────────────────────────────────────────────────────
export function registerCmsCollectTaskHandler(): void {
  registerTaskHandler({
    taskType: 'cms-collect-run',
    title: 'CMS 采集执行',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const ruleId = Number((ctx.payload as { ruleId?: number })?.ruleId);
      const operatorId = Number((ctx.payload as { operatorId?: number })?.operatorId) || 1;
      if (!ruleId) throw new Error('缺少 ruleId 参数');
      const [rule] = await db.select().from(cmsCollectRules).where(eq(cmsCollectRules.id, ruleId)).limit(1);
      if (!rule) throw new Error(`采集规则不存在（id=${ruleId}）`);
      const [channel] = await db.select().from(cmsChannels).where(eq(cmsChannels.id, rule.channelId)).limit(1);
      if (!channel) throw new Error('目标栏目不存在');

      await ctx.progress({ processed: 0, total: 0, note: '抓取列表页…' });
      const links = await extractListLinks(rule);
      const total = links.length;
      let processed = 0;
      let success = 0;
      let skipped = 0;
      let failed = 0;

      for (const url of links) {
        processed += 1;
        // URL 级去重
        const [dup] = await db.select({ id: cmsCollectItems.id }).from(cmsCollectItems)
          .where(and(eq(cmsCollectItems.ruleId, rule.id), eq(cmsCollectItems.url, url))).limit(1);
        if (dup) {
          skipped += 1;
          const { cancelRequested } = await ctx.progress({ processed, total, note: `跳过重复 ${skipped} 条` });
          if (cancelRequested) break;
          continue;
        }
        try {
          const html = await fetchHtml(url);
          const article = extractArticle(html, url, rule);
          let bodyHtml = article.bodyHtml;
          if (rule.localizeImages) {
            bodyHtml = await localizeArticleImages(bodyHtml, operatorId);
          }
          const [content] = await db.insert(cmsContents).values({
            siteId: rule.siteId,
            channelId: rule.channelId,
            modelId: channel.modelId ?? null,
            title: article.title,
            summary: article.summary,
            coverImage: article.coverImage,
            body: bodyHtml,
            source: '采集',
            status: rule.autoPublish ? 'published' : 'draft',
            publishedAt: rule.autoPublish ? new Date() : null,
            searchVector: buildSearchVector({ title: article.title, summary: article.summary, body: bodyHtml, seoKeywords: null, extendTexts: [] }),
          }).returning({ id: cmsContents.id });
          await db.insert(cmsCollectItems).values({ ruleId: rule.id, url, title: article.title, status: 'success', contentId: content.id })
            .onConflictDoNothing();
          success += 1;
          await ctx.reportItems([{ key: url.slice(0, 200), label: article.title, status: 'success' }]);
          if (rule.autoPublish) {
            const { triggerContentStaticRefresh } = await import('./cms-static.service');
            triggerContentStaticRefresh(content.id);
          }
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message.slice(0, 500) : '采集失败';
          await db.insert(cmsCollectItems).values({ ruleId: rule.id, url, status: 'failed', error: message })
            .onConflictDoNothing();
          await ctx.reportItems([{ key: url.slice(0, 200), label: url, status: 'failed', message }]);
        }
        const { cancelRequested } = await ctx.progress({ processed, total, note: `成功 ${success} / 跳过 ${skipped} / 失败 ${failed}` });
        if (cancelRequested) break;
      }

      await db.update(cmsCollectRules).set({ lastRunAt: new Date() }).where(eq(cmsCollectRules.id, rule.id));
      return { total, success, skipped, failed };
    },
  });
}
