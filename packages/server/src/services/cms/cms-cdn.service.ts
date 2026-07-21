import type { CmsSiteRow } from '../../db/schema';
import { httpPost } from '../../lib/http-client';
import logger from '../../lib/logger';
import { siteOrigin } from './cms-render.service';
import {
  CMS_CDN_HTTP_SAFETY_OPTIONS, cmsCdnPurgeHostAllowlist, validateCdnPurgeEndpoint,
} from './cms-cdn-policy';
export {
  cmsCdnPurgeHostAllowlist, validateCdnPurgeEndpoint,
} from './cms-cdn-policy';

/**
 * CDN 刷新对接（P5 企业级治理）：静态化产物更新后向通用 purge webhook 推送变更路径，
 * 由接收端（自建代理 / 云厂商函数）转译为具体 CDN 服务商的刷新 API 调用。
 *
 * 站点 settings 配置：
 * - cdnPurgeUrl   刷新回调地址（空 = 不启用）
 * - cdnPurgeToken 可选鉴权令牌（Bearer）
 *
 * 请求体：{ siteCode, origin, purgeAll, paths[], urls[] }
 */

interface CdnPurgeConfig {
  url: string;
  token: string | null;
}

function cdnConfig(site: CmsSiteRow): CdnPurgeConfig | null {
  const settings = (site.settings ?? {}) as Record<string, unknown>;
  const rawUrl = typeof settings.cdnPurgeUrl === 'string' ? settings.cdnPurgeUrl.trim() : '';
  if (!rawUrl) return null;
  const url = validateCdnPurgeEndpoint(rawUrl, cmsCdnPurgeHostAllowlist()).toString();
  const token = typeof settings.cdnPurgeToken === 'string' && settings.cdnPurgeToken.trim() !== ''
    ? settings.cdnPurgeToken.trim()
    : null;
  return { url, token };
}

/** 规范化站内路径（以 / 开头；折叠重复斜杠；'' → '/'） */
function normalizePath(p: string): string {
  const cleaned = p.trim().replace(/\/{2,}/g, '/');
  if (cleaned === '' || cleaned === '/') return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

async function sendPurge(site: CmsSiteRow, paths: string[], purgeAll: boolean): Promise<void> {
  const cfg = cdnConfig(site);
  if (!cfg) return;
  const origin = siteOrigin(site);
  const unique = [...new Set(paths.map(normalizePath))];
  const body = {
    siteCode: site.code,
    origin,
    purgeAll,
    paths: purgeAll ? [] : unique,
    urls: purgeAll ? [] : (origin ? unique.map((p) => `${origin}${p}`) : []),
  };
  const res = await httpPost(cfg.url, body, {
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    },
    timeout: 10_000,
    ...CMS_CDN_HTTP_SAFETY_OPTIONS,
  });
  if (!res.ok) {
    throw new Error(`CDN purge webhook 响应 ${res.status}`);
  }
}

/** 增量刷新（fire-and-forget，失败仅记日志不影响静态化结果） */
export function triggerCdnPurge(site: CmsSiteRow, paths: string[]): void {
  if (paths.length === 0) return;
  void sendPurge(site, paths, false).catch((err) => {
    logger.warn(`[CMS] 站点 ${site.code} CDN 刷新失败: ${err instanceof Error ? err.message : err}`);
  });
}

/** 全站刷新（整站重建完成后调用） */
export function triggerCdnPurgeAll(site: CmsSiteRow): void {
  void sendPurge(site, [], true).catch((err) => {
    logger.warn(`[CMS] 站点 ${site.code} CDN 全站刷新失败: ${err instanceof Error ? err.message : err}`);
  });
}
