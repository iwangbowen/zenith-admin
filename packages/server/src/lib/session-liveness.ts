import type { Context } from 'hono';
import logger from './logger';
import { getClientIp, parseUserAgent } from './request-helpers';

export interface SessionLivenessDeps {
  /** 令牌是否已被强制下线（黑名单） */
  isBlacklisted: (jti: string) => Promise<boolean> | boolean;
  /** 续期在线会话；返回 false 表示会话缺失（如 Redis 重启），调用方可懒重注册 */
  touch: (jti: string) => Promise<boolean> | boolean;
  /** 日志前缀，如 `[Auth]` / `[MemberAuth]` */
  logPrefix: string;
}

/**
 * 认证中间件共用的会话活性检查：黑名单检查与会话续期相互独立，并行执行。
 * 两者均为 best-effort——Redis 故障只记 warning、不阻断请求；续期失败按「状态未知」
 * 处理（`touched` 返回 true），避免在故障期间反复懒重注册。
 */
export async function checkSessionLiveness(jti: string, deps: SessionLivenessDeps): Promise<{ blacklisted: boolean; touched: boolean }> {
  const [blacklisted, touched] = await Promise.all([
    Promise.resolve(deps.isBlacklisted(jti)).catch((err) => {
      logger.warn(`${deps.logPrefix} Redis blacklist check failed, allowing request:`, err);
      return false;
    }),
    Promise.resolve(deps.touch(jti)).catch((err) => {
      logger.warn(`${deps.logPrefix} Redis session touch failed, allowing request:`, err);
      return true;
    }),
  ]);
  return { blacklisted, touched };
}

/** 会话注册所需的客户端指纹：IP + User-Agent 解析出的浏览器 / 操作系统 */
export function clientFingerprint(c: Context): { ip: string; browser: string; os: string } {
  const { browser, os } = parseUserAgent(c.req.header('user-agent') ?? '');
  return { ip: getClientIp(c), browser, os };
}
