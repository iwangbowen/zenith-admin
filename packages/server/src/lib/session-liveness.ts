import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SessionClientKind, SessionRevokeReason } from '@zenith/shared/identity';
import logger from './logger';
import { errBody } from './openapi-schemas';
import { getClientIp, getClientKind, getPlatformVersion, parseUserAgent } from './request-helpers';

export interface SessionLivenessDeps {
  /** 令牌的吊销原因（登出 / 强制下线 / 被挤下线 / 改密 / 轮换）；未吊销为 null */
  revocation: (jti: string) => Promise<SessionRevokeReason | null> | SessionRevokeReason | null;
  /** 续期在线会话；返回 false 表示会话缺失（如 Redis 重启），调用方可懒重注册 */
  touch: (jti: string) => Promise<boolean> | boolean;
  /** 日志前缀，如 `[Auth]` / `[MemberAuth]` */
  logPrefix: string;
}

/** 吊销原因对应的 401 文案：让用户分得清「被挤下线」「改了密码」与「被管理员强退」 */
export const SESSION_REVOKED_MESSAGES: Record<SessionRevokeReason, string> = {
  'concurrent-login': '您的账号已在其他设备登录，当前会话已退出',
  'password-changed': '密码已修改，请重新登录',
  'force-logout': '会话已被强制下线',
  logout: '已退出登录，请重新登录',
  rotated: '登录状态已失效，请重新登录',
};

/** 会话已吊销的 401 响应体：文案 + 机读原因（前端登录页据此展示精确提示，WS 断开时也不丢信息） */
export function sessionRevokedBody(reason: SessionRevokeReason) {
  return { ...errBody(SESSION_REVOKED_MESSAGES[reason], 401), reason };
}

/** 服务层抛出的「会话已吊销」：全局错误处理按 sessionRevokedBody 渲染，保留机读原因（如 refresh 续签遇到被挤下线的 jti） */
export class SessionRevokedException extends HTTPException {
  constructor(readonly reason: SessionRevokeReason) {
    super(401, { message: SESSION_REVOKED_MESSAGES[reason] });
  }
}

/**
 * 认证中间件共用的会话活性检查：吊销检查与会话续期相互独立，并行执行。
 * 两者均为 best-effort——Redis 故障只记 warning、不阻断请求；续期失败按「状态未知」
 * 处理（`touched` 返回 true），避免在故障期间反复懒重注册。
 */
export async function checkSessionLiveness(jti: string, deps: SessionLivenessDeps): Promise<{ revoked: SessionRevokeReason | null; touched: boolean }> {
  const [revoked, touched] = await Promise.all([
    Promise.resolve(deps.revocation(jti)).catch((err) => {
      logger.warn(`${deps.logPrefix} Redis blacklist check failed, allowing request:`, err);
      return null;
    }),
    Promise.resolve(deps.touch(jti)).catch((err) => {
      logger.warn(`${deps.logPrefix} Redis session touch failed, allowing request:`, err);
      return true;
    }),
  ]);
  return { revoked, touched };
}

/** 会话注册所需的客户端指纹：IP、终端类型 + User-Agent 解析出的浏览器 / 操作系统
 *（审计口径：只信服务端请求头与 Client Hints，不采纳客户端自报的展示值） */
export function clientFingerprint(c: Context): { ip: string; client: SessionClientKind; browser: string; os: string } {
  const { browser, os } = parseUserAgent(c.req.header('user-agent') ?? '', getPlatformVersion(c));
  return { ip: getClientIp(c), client: getClientKind(c), browser, os };
}
