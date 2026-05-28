import { createMiddleware } from 'hono/factory';
import { jwt, type JwtVariables } from 'hono/jwt';
import { isTokenBlacklisted, touchSession, registerSession } from '../lib/session-manager';
import { getClientIp, parseUserAgent } from '../lib/request-helpers';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import logger from '../lib/logger';

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
    return c.json(errBody('未登录', 401), 401);
  }

  try {
    // Delegate signature and claims verification to Hono's official JWT middleware.
    await jwtMiddleware(c, async () => {});
    const payload = c.get('jwtPayload') as JwtPayload;

    // Check if this token has been force-logged-out (best-effort, don't block on Redis errors)
    if (payload.jti) {
      try {
        const blacklisted = await isTokenBlacklisted(payload.jti);
        if (blacklisted) {
          return c.json(errBody('会话已被强制下线', 401), 401);
        }
      } catch (redisErr) {
        logger.warn('[Auth] Redis blacklist check failed, allowing request:', redisErr);
      }
    }

    // Refresh session activity (best-effort, don't block on Redis errors)
    if (payload.jti) {
      try {
        const existed = await touchSession(payload.jti);
        // Session missing (e.g. Redis restarted) — lazily re-register to keep online-users list accurate
        if (!existed) {
          const ip = getClientIp(c);
          const ua = c.req.header('user-agent') ?? '';
          const { browser, os } = parseUserAgent(ua);
          const [u] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, payload.userId)).limit(1);
          if (u) {
            registerSession({
              tokenId: payload.jti,
              userId: payload.userId,
              username: payload.username,
              nickname: u.nickname,
              tenantId: payload.tenantId ?? null,
              ip,
              browser,
              os,
              loginAt: new Date(),
            }).catch(() => { /* best-effort, ignore errors */ });
          }
        }
      } catch (redisErr) {
        logger.warn('[Auth] Redis session touch failed, allowing request:', redisErr);
      }
    }

    c.set('user', payload);
    await next();
  } catch (err) {
    logger.warn('[Auth] JWT verification failed:', err);
    return c.json(errBody('登录已过期', 401), 401);
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
