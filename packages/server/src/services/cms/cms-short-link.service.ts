/**
 * 内容发布 → 分享短链（发布副作用，fire-and-forget）。
 *
 * 站点未绑定域名或内容为外链时静默跳过；
 * 幂等复用 short-link 域的 ensureShortLink（bizType=cms_content，bizRef=内容 ID），
 * 重新发布或改址时同步更新短链目标。
 */
import logger from '../../lib/logger';
import { ensureShortLink } from '../short-link/short-link.service';
import { loadPublishedContentTarget } from './cms-published-content-target';

export function triggerShortLinkForContent(contentId: number): void {
  void ensureCmsPublishedShortLink(contentId).catch((err) => {
    logger.warn(`[CMS] 内容 ${contentId} 发布短链生成失败`, err);
  });
}

export async function ensureCmsPublishedShortLink(contentId: number): Promise<void> {
    const target = await loadPublishedContentTarget(contentId);
    if (!target) return;
    await ensureShortLink({
      targetUrl: `${target.origin}${target.path}`,
      bizType: 'cms_content',
      bizRef: String(contentId),
      title: target.content.title,
      tenantId: null,
    });
}
