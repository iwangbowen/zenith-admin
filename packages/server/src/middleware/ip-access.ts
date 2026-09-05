import { createMiddleware } from 'hono/factory';
import ipRangeCheck from 'ip-range-check';
import { getSettings } from '../lib/settings';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import { writeIpAccessLog } from '../services/platform/ip-access-logs.service';

/** 免检路径：这些接口无需经过 IP 访问控制 */
const EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/captcha',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

/**
 * IP 黑白名单：配置来自运行时设置 `ipAccess` 模块（平台级）。
 * 读取命中进程内副本时零查询；管理端保存后经 cache_invalidate 广播即时生效，无需本地失效钩子。
 */
export const ipAccessMiddleware = createMiddleware(async (c, next) => {
  const path = c.req.path;

  // 免检路径
  if (EXEMPT_PATHS.has(path) || path.startsWith('/api/oauth/') || path.startsWith('/api/auth/oauth/')) {
    return next();
  }

  const cfg = await getSettings('ipAccess');

  // 如果两者都未启用，直接放行（快速路径）
  if (!cfg.blacklistEnabled && !cfg.whitelistEnabled) {
    return next();
  }

  const ip = getClientIp(c);

  // 黑名单优先检查
  if (cfg.blacklistEnabled && cfg.blacklist.length > 0) {
    const blocked = ipRangeCheck(ip, cfg.blacklist);
    if (blocked) {
      void writeIpAccessLog({ ip, path, method: c.req.method, blockType: 'blacklist', userAgent: c.req.header('user-agent') });
      return c.json(errBody('您的IP已被禁止访问', 403), 403);
    }
  }

  // 白名单检查
  if (cfg.whitelistEnabled && cfg.whitelist.length > 0) {
    const allowed = ipRangeCheck(ip, cfg.whitelist);
    if (!allowed) {
      void writeIpAccessLog({ ip, path, method: c.req.method, blockType: 'whitelist', userAgent: c.req.header('user-agent') });
      return c.json(errBody('您的IP不在允许访问范围内', 403), 403);
    }
  }

  return next();
});