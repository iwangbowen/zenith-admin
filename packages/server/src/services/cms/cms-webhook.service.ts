/**
 * CMS 内容事件 Webhook：内容发布/下线/回收时向站点配置的回调地址外推事件，
 * 供外部系统（搜索引擎爬虫、缓存刷新、数据同步等）联动。
 *
 * 站点 settings 配置：
 *   - webhookUrl：回调地址（http/https）；空 = 不推送
 *   - webhookSecret：可选签名密钥，请求头 X-Cms-Signature = HMAC-SHA256(body)
 *
 * fire-and-forget：不阻塞主流程，失败仅记日志（5s 超时，SSRF 防护）。
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents, cmsSites } from '../../db/schema';
import { httpRequest } from '../../lib/http-client';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';

export type CmsWebhookEvent = 'content.published' | 'content.offline' | 'content.recycled';

/** 触发内容事件 Webhook（异步执行，不抛错） */
export function triggerCmsContentWebhook(event: CmsWebhookEvent, contentId: number): void {
  void deliverCmsContentWebhook(event, contentId).catch((err) => {
    logger.warn(`[cms-webhook] 事件 ${event} 内容 #${contentId} 推送失败`, err);
  });
}

async function deliverCmsContentWebhook(event: CmsWebhookEvent, contentId: number): Promise<void> {
  const [content] = await db.select({
    id: cmsContents.id,
    siteId: cmsContents.siteId,
    channelId: cmsContents.channelId,
    title: cmsContents.title,
    slug: cmsContents.slug,
    status: cmsContents.status,
  }).from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!content) return;
  const [site] = await db.select({ code: cmsSites.code, settings: cmsSites.settings })
    .from(cmsSites).where(eq(cmsSites.id, content.siteId)).limit(1);
  if (!site) return;
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  const url = typeof settings.webhookUrl === 'string' ? settings.webhookUrl.trim() : '';
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;

  const body = JSON.stringify({
    event,
    occurredAt: formatDateTime(new Date()),
    site: { id: content.siteId, code: site.code },
    content: {
      id: content.id,
      channelId: content.channelId,
      title: content.title,
      slug: content.slug,
      status: content.status,
    },
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = typeof settings.webhookSecret === 'string' ? settings.webhookSecret : '';
  if (secret) {
    headers['X-Cms-Signature'] = createHmac('sha256', secret).update(body).digest('hex');
  }
  const res = await httpRequest(url, {
    method: 'POST',
    headers,
    body,
    timeout: 5000,
    ssrfProtection: true,
  });
  if (!res.ok) {
    logger.warn(`[cms-webhook] 事件 ${event} 内容 #${contentId} 回调返回 ${res.status}`);
  }
}
