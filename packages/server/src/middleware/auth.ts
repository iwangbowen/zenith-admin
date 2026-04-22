import { createMiddleware } from 'hono/factory';
import { jwt, type JwtVariables } from 'hono/jwt';
import { isTokenBlacklisted, touchSession } from '../lib/session-manager';
import { config } from '../config';

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
  Variables: JwtVariables<JwtPayload> & {
    user: JwtPayload;
    auditBeforeData?: string;
  };
};

const jwtMiddleware = jwt({
  secret: config.jwtSecret,
  alg: 'HS256',
});

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '未登录', data: null }, 401);
  }

  try {
    // Delegate signature and claims verification to Hono's official JWT middleware.
    await jwtMiddleware(c, async () => {});
    const payload = c.get('jwtPayload') as JwtPayload;

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

/**
 * 全局 ContextVariableMap 扩展：让 c.get('user') / c.get('auditBeforeData')
 * 在所有路由处理器（包括 defineOpenAPIRoute handler）中均可类型安全访问，
 * 无需为每个路由器重复声明 AuthEnv 泛型。
 */
declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
    auditBeforeData: string | undefined;
  }
}
