import { createMiddleware } from 'hono/factory';
import { verifyToken } from '../lib/jwt';
import { isTokenBlacklisted, touchSession } from '../lib/session-manager';

export interface JwtPayload {
  userId: number;
  username: string;
  roles: string[];
  tenantId: number | null;
  /** 超管切换租户视角时，存放目标租户 ID */
  viewingTenantId?: number | null;
  jti?: string;
}

/** Hono Env 类型——声明 Variables 中的 user 字段类型，供中间件消费方推断 */
export type AuthEnv = {
  Variables: {
    user: JwtPayload;
    auditBeforeData?: string;
  };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '未登录', data: null }, 401);
  }

  const token = authorization.slice(7);
  try {
    const payload = await verifyToken<JwtPayload>(token);

    // Check if this token has been force-logged-out
    if (payload.jti) {
      const blacklisted = await isTokenBlacklisted(payload.jti);
      if (blacklisted) {
        return c.json({ code: 401, message: '会话已被强制下线', data: null }, 401);
      }
    }

    // Refresh session activity
    if (payload.jti) {
      await touchSession(payload.jti);
    }

    c.set('user', payload);
    await next();
  } catch {
    return c.json({ code: 401, message: '登录已过期', data: null }, 401);
  }
});
