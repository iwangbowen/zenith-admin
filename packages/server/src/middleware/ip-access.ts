import type { MiddlewareHandler } from 'hono';
import ipRangeCheck from 'ip-range-check';
import { getConfigBoolean, getConfigValue } from '../lib/system-config';

/** 免检路径：这些接口无需经过 IP 访问控制 */
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/captcha',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

interface IpAccessConfig {
  whitelistEnabled: boolean;
  whitelist: string[];
  blacklistEnabled: boolean;
  blacklist: string[];
  cachedAt: number;
}

let cache: IpAccessConfig | null = null;
const CACHE_TTL = 30_000; // 30 秒

async function loadConfig(): Promise<IpAccessConfig> {
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL) {
    return cache;
  }

  const [whitelistEnabled, whitelistRaw, blacklistEnabled, blacklistRaw] = await Promise.all([
    getConfigBoolean('ip_whitelist_enabled'),
    getConfigValue('ip_whitelist', '[]'),
    getConfigBoolean('ip_blacklist_enabled'),
    getConfigValue('ip_blacklist', '[]'),
  ]);

  let whitelist: string[] = [];
  let blacklist: string[] = [];

  try { whitelist = JSON.parse(whitelistRaw); } catch { whitelist = []; }
  try { blacklist = JSON.parse(blacklistRaw); } catch { blacklist = []; }

  cache = { whitelistEnabled, whitelist, blacklistEnabled, blacklist, cachedAt: Date.now() };
  return cache;
}

/** 使当前缓存立即失效，下次请求时重新加载 */
export function invalidateIpAccessCache() {
  cache = null;
}

export const ipAccessMiddleware: MiddlewareHandler = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // 免检路径
  if (EXEMPT_PATHS.has(path) || path.startsWith('/api/oauth/') || path.startsWith('/api/auth/oauth/')) {
    return next();
  }

  const cfg = await loadConfig();

  // 如果两者都未启用，直接放行（快速路径）
  if (!cfg.blacklistEnabled && !cfg.whitelistEnabled) {
    return next();
  }

  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim()
    ?? c.req.header('x-real-ip')
    ?? '127.0.0.1';

  // 黑名单优先检查
  if (cfg.blacklistEnabled && cfg.blacklist.length > 0) {
    const blocked = ipRangeCheck(ip, cfg.blacklist);
    if (blocked) {
      return c.json({ code: 403, message: '您的IP已被禁止访问', data: null }, 403);
    }
  }

  // 白名单检查
  if (cfg.whitelistEnabled && cfg.whitelist.length > 0) {
    const allowed = ipRangeCheck(ip, cfg.whitelist);
    if (!allowed) {
      return c.json({ code: 403, message: '您的IP不在允许访问范围内', data: null }, 403);
    }
  }

  return next();
};
