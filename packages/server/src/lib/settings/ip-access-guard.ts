import { tryGetContext } from 'hono/context-storage';
import { HTTPException } from 'hono/http-exception';
import { evaluateIpAccess, type IpAccessSettings } from '@zenith/shared/settings';
import { getClientIp } from '../request-helpers';

/** Authoritative protection shared by settings save and version restore. */
export function assertIpAccessChange(policy: IpAccessSettings): void {
  if (!policy.whitelistEnabled && !policy.blacklistEnabled) return;
  const context = tryGetContext();
  if (!context) throw new HTTPException(400, { message: '启用访问控制必须在可验证来源 IP 的请求中操作' });
  const ip = getClientIp(context);
  if (!evaluateIpAccess(policy, ip).allowed) throw new HTTPException(400, { message: `该配置会阻断当前来源 IP（${ip}），请先调整名单` });
}
