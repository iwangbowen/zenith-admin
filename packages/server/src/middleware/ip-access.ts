import { createMiddleware } from 'hono/factory';
import { evaluateIpAccess, type IpAccessSettings } from '@zenith/shared/settings';
import { getSettings } from '../lib/settings';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import { writeIpAccessLog } from '../services/platform/ip-access-logs.service';

/** All API requests, including login, public routes and WS handshakes, share one policy. */
export const ipAccessMiddleware = createMiddleware(async (c, next) => {
  let policy: IpAccessSettings;
  try { policy = await getSettings('ipAccess'); }
  catch { return c.json(errBody('IP 访问策略暂不可用，请联系管理员', 503), 503); }
  if (!policy.blacklistEnabled && !policy.whitelistEnabled) return next();
  const ip = getClientIp(c);
  const decision = evaluateIpAccess(policy, ip);
  if (decision.allowed) return next();
  const blockType = decision.reason === 'blacklist' ? 'blacklist' : 'whitelist';
  void writeIpAccessLog({ ip, path: c.req.path, method: c.req.method, blockType, userAgent: c.req.header('user-agent') });
  return c.json(errBody(blockType === 'blacklist' ? '您的IP已被禁止访问' : '您的IP不在允许访问范围内', 403), 403);
});
