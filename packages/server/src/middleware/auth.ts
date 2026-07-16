import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { jwt, type JwtVariables } from 'hono/jwt';
import { isTokenBlacklisted, touchSession, registerSession } from '../lib/session-manager';
import { getClientIp, parseUserAgent } from '../lib/request-helpers';
import { db } from '../db';
import { userApiTokens, users } from '../db/schema';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
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
  authType?: 'jwt' | 'apiToken';
  apiTokenId?: number;
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

const API_TOKEN_PREFIX = 'zat_';
const API_TOKEN_LAST_USED_THROTTLE_MS = 5 * 60_000;

async function authenticateApiToken(rawToken: string): Promise<JwtPayload | null> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const row = await db.query.userApiTokens.findFirst({
    where: and(
      eq(userApiTokens.tokenHash, tokenHash),
      or(isNull(userApiTokens.expiresAt), gt(userApiTokens.expiresAt, new Date())),
    ),
    columns: {
      id: true,
      lastUsedAt: true,
    },
    with: {
      user: {
        columns: {
          id: true,
          username: true,
          tenantId: true,
          status: true,
        },
        with: {
          tenant: {
            columns: {
              status: true,
              expireAt: true,
            },
          },
          userRoles: {
            columns: {},
            with: {
              role: {
                columns: {
                  code: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!row || row.user.status !== 'enabled') return null;
  if (row.user.tenantId !== null) {
    if (
      !row.user.tenant
      || row.user.tenant.status !== 'enabled'
      || (row.user.tenant.expireAt && row.user.tenant.expireAt < new Date())
    ) {
      return null;
    }
  }

  const cutoff = new Date(Date.now() - API_TOKEN_LAST_USED_THROTTLE_MS);
  if (!row.lastUsedAt || row.lastUsedAt < cutoff) {
    db.update(userApiTokens)
      .set({ lastUsedAt: new Date() })
      .where(and(
        eq(userApiTokens.id, row.id),
        or(isNull(userApiTokens.lastUsedAt), lt(userApiTokens.lastUsedAt, cutoff)),
      ))
      .catch((err) => logger.warn('[Auth] API token last-used update failed:', err));
  }

  return {
    userId: row.user.id,
    username: row.user.username,
    roles: row.user.userRoles
      .filter(({ role }) => role.status === 'enabled')
      .map(({ role }) => role.code),
    tenantId: row.user.tenantId ?? null,
    authType: 'apiToken',
    apiTokenId: row.id,
  };
}

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json(errBody('未登录', 401), 401);
  }

  try {
    const rawToken = authorization.slice('Bearer '.length);
    if (rawToken.startsWith(API_TOKEN_PREFIX)) {
      const payload = await authenticateApiToken(rawToken);
      if (!payload) return c.json(errBody('API Token 无效或已过期', 401), 401);
      c.set('user', payload);
      await next();
      return;
    }

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
