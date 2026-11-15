import { createMiddleware } from 'hono/factory';
import { evaluateIpAccess, type IpAccessSettings } from '@zenith/shared/settings';
import { getIpAccessPolicySnapshot } from '../lib/settings';
import { safeRequestPath } from '../lib/safe-request-path';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import { writeIpAccessLog } from '../services/platform/ip-access-logs.service';

/** All API requests, including login, public routes and WS handshakes, share one policy. */
export const ipAccessMiddleware = createMiddleware(async (c, next) => {
  let policy: IpAccessSettings;
  let version: number;
  try { ({ policy, version } = await getIpAccessPolicySnapshot()); }
  catch { return c.json(errBody('IP 访问策略暂不可用，请联系管理员', 503), 503); }
  if (!policy.blacklistEnabled && !policy.whitelistEnabled) return next();
  const ip = getClientIp(c);
  const decision = evaluateIpAccess(policy, ip);
  if (decision.allowed) return next();
  const blockType = decision.reason === 'blacklist' || decision.reason === 'invalid-ip' ? decision.reason : 'whitelist';
  const path = safeRequestPath(c);
  c.set('rateLimitSafePath', path);
  writeIpAccessLog({ ip, path, method: c.req.method, blockType, userAgent: c.req.header('user-agent'), matchedEntry: decision.matchedEntry, policyVersion: version, correlationId: c.get('requestId') ?? null });
  const message = blockType === 'invalid-ip' ? '无法确认有效的来源 IP' : blockType === 'blacklist' ? '您的IP已被禁止访问' : '您的IP不在允许访问范围内';
  return c.json(errBody(message, 403), 403);
});
