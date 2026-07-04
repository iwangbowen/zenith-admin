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
    auditAfterData?: string;
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

    // 安全隔离：拒绝会员 token 访问管理端接口（会员 token 带 type='member'）
    if ((payload as { type?: string }).type === 'member') {
      return c.json(errBody('无效的访问令牌', 401), 401);
    }

    // Blacklist check + session touch are independent Redis ops — run in parallel
    // (each best-effort: Redis errors log a warning and never block the request)
    if (payload.jti) {
      const jti = payload.jti;
      const [blacklisted, touched] = await Promise.all([
        Promise.resolve(isTokenBlacklisted(jti)).catch((redisErr) => {
          logger.warn('[Auth] Redis blacklist check failed, allowing request:', redisErr);
          return false;
        }),
        Promise.resolve(touchSession(jti)).catch((redisErr) => {
          logger.warn('[Auth] Redis session touch failed, allowing request:', redisErr);
          return true; // unknown state — skip lazy re-register
        }),
      ]);
      if (blacklisted) {
        return c.json(errBody('会话已被强制下线', 401), 401);
      }
      // Session missing (e.g. Redis restarted) — lazily re-register to keep online-users list accurate
      // (best-effort: any failure here must not block the request)
      if (!touched) {
        try {
          const ip = getClientIp(c);
          const ua = c.req.header('user-agent') ?? '';
          const { browser, os } = parseUserAgent(ua);
          const [u] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, payload.userId)).limit(1);
          if (u) {
            registerSession({
              tokenId: jti,
              userId: payload.userId,
              username: payload.username,
              nickname: u.nickname,
              tenantId: payload.tenantId ?? null,
              ip,
              browser,
              os,
              location: null,
              loginAt: new Date(),
            }).catch(() => { /* best-effort, ignore errors */ });
          }
        } catch (err) {
          logger.warn('[Auth] Session lazy re-register failed, allowing request:', err);
        }
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
    auditAfterData: string | undefined;
  }
}
