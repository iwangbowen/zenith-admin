import { eq, desc, and, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsPushLogs, cmsSites, cmsContents, cmsChannels } from '../../db/schema';
import type { CmsSiteRow, CmsPushLogRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, withPagination } from '../../lib/where-helpers';
import { httpPost } from '../../lib/http-client';
import logger from '../../lib/logger';
import { assertSiteAccess } from './cms-sites.service';
import { siteOrigin, contentUrl } from './cms-render.service';

export type CmsPushEngine = 'baidu' | 'indexnow';

interface SitePushConfig {
  baiduPushToken: string | null;
  indexNowKey: string | null;
}

/** 站点推送配置（存 cms_sites.settings JSONB） */
export function getSitePushConfig(site: CmsSiteRow): SitePushConfig {
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  return {
    baiduPushToken: typeof settings.baiduPushToken === 'string' && settings.baiduPushToken.trim() ? settings.baiduPushToken.trim() : null,
    indexNowKey: typeof settings.indexNowKey === 'string' && settings.indexNowKey.trim() ? settings.indexNowKey.trim() : null,
  };
}

export function mapCmsPushLog(row: CmsPushLogRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    engine: row.engine,
    urls: row.urls ?? [],
    success: row.success,
    statusCode: row.statusCode ?? null,
    response: row.response ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function writePushLog(siteId: number, engine: CmsPushEngine, urls: string[], success: boolean, statusCode: number | null, response: string) {
  await db.insert(cmsPushLogs).values({
    siteId, engine, urls, success, statusCode,
    response: response.slice(0, 2000),
  });
}

/** 百度普通收录 API 主动推送（http://data.zz.baidu.com/urls?site=xxx&token=xxx，body 为换行分隔 URL） */
async function pushToBaidu(site: CmsSiteRow, origin: string, token: string, urls: string[]): Promise<boolean> {
  try {
    const res = await httpPost(
      `http://data.zz.baidu.com/urls?site=${encodeURIComponent(origin)}&token=${encodeURIComponent(token)}`,
      urls.join('\n'),
      { headers: { 'Content-Type': 'text/plain' }, timeout: 15_000 },
    );
    const ok = res.status === 200;
    await writePushLog(site.id, 'baidu', urls, ok, res.status, await res.text().catch(() => ''));
    return ok;
  } catch (err) {
    await writePushLog(site.id, 'baidu', urls, false, null, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** IndexNow 协议推送（Bing/Yandex 等，https://api.indexnow.org/indexnow） */
async function pushToIndexNow(site: CmsSiteRow, origin: string, key: string, urls: string[]): Promise<boolean> {
  try {
    const host = new URL(origin).host;
    const res = await httpPost('https://api.indexnow.org/indexnow', {
      host,
      key,
      keyLocation: `${origin}/${key}.txt`,
      urlList: urls,
    }, { timeout: 15_000 });
    const ok = res.status === 200 || res.status === 202;
    await writePushLog(site.id, 'indexnow', urls, ok, res.status, await res.text().catch(() => ''));
    return ok;
  } catch (err) {
    await writePushLog(site.id, 'indexnow', urls, false, null, err instanceof Error ? err.message : String(err));
    return false;
  }
}

export interface PushResult {
  engine: CmsPushEngine;
  submitted: boolean;
  reason?: string;
}

/** 推送 URL 到已配置的搜索引擎；urls 为站内相对路径或绝对地址 */
export async function pushCmsUrls(siteId: number, urls: string[], engines?: CmsPushEngine[]): Promise<PushResult[]> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  const origin = siteOrigin(site);
  if (!origin) throw new HTTPException(400, { message: '站点未绑定域名，无法推送搜索引擎' });
  const absolute = [...new Set(urls.map((u) => (u.startsWith('http') ? u : `${origin}${u.startsWith('/') ? u : `/${u}`}`)))].slice(0, 2000);
  if (absolute.length === 0) throw new HTTPException(400, { message: '没有可推送的 URL' });

  const cfg = getSitePushConfig(site);
  const targets = engines ?? (['baidu', 'indexnow'] as CmsPushEngine[]);
  const results: PushResult[] = [];
  for (const engine of targets) {
    if (engine === 'baidu') {
      if (!cfg.baiduPushToken) {
        results.push({ engine, submitted: false, reason: '未配置百度推送 Token' });
        continue;
      }
      results.push({ engine, submitted: await pushToBaidu(site, origin, cfg.baiduPushToken, absolute) });
    } else {
      if (!cfg.indexNowKey) {
        results.push({ engine, submitted: false, reason: '未配置 IndexNow Key' });
        continue;
      }
      results.push({ engine, submitted: await pushToIndexNow(site, origin, cfg.indexNowKey, absolute) });
    }
  }
  return results;
}

/** 内容发布后自动推送（未配置引擎时静默跳过；路由 fire-and-forget 调用） */
export function triggerAutoPushForContent(contentId: number): void {
  void (async () => {
    const [row] = await db.select({
      content: cmsContents,
      channelPath: cmsChannels.path,
      site: cmsSites,
    })
      .from(cmsContents)
      .innerJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
      .innerJoin(cmsSites, eq(cmsContents.siteId, cmsSites.id))
      .where(eq(cmsContents.id, contentId))
      .limit(1);
    if (!row || row.content.status !== 'published' || row.content.externalLink?.trim()) return;
    const cfg = getSitePushConfig(row.site);
    if (!cfg.baiduPushToken && !cfg.indexNowKey) return;
    if (!siteOrigin(row.site)) return;
    await pushCmsUrls(row.site.id, [contentUrl('', row.channelPath, row.content)]);
  })().catch((err) => {
    logger.error(`[CMS] 内容 ${contentId} 自动推送失败`, err);
  });
}

// ─── 推送日志 ─────────────────────────────────────────────────────────────────
export interface ListCmsPushLogsQuery {
  siteId: number;
  engine?: CmsPushEngine;
  page: number;
  pageSize: number;
}

export async function listCmsPushLogs(q: ListCmsPushLogsQuery) {
  await assertSiteAccess(q.siteId);
  const conditions: SQL[] = [eq(cmsPushLogs.siteId, q.siteId)];
  if (q.engine) conditions.push(eq(cmsPushLogs.engine, q.engine));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsPushLogs, where),
    withPagination(
      db.select().from(cmsPushLogs).where(where).orderBy(desc(cmsPushLogs.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsPushLog), total, page: q.page, pageSize: q.pageSize };
}
