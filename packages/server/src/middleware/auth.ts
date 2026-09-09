import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { jwt, type JwtVariables } from 'hono/jwt';
import { isTokenBlacklisted, touchSession, registerSession } from '../lib/session-manager';
import { checkSessionLiveness, clientFingerprint } from '../lib/session-liveness';
import { db } from '../db';
import { tenants, userApiTokens, users } from '../db/schema';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import logger from '../lib/logger';
import { isSuperAdmin } from '../lib/permissions';
import { isTenantActive } from '../lib/tenant';

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

type AdminJwtCheck =
  | { ok: true; payload: JwtPayload }
  | { ok: false; status: 401 | 403; message: string };

/**
 * JWT signature verification is not enough for a long-lived access token:
 * users and tenants can be disabled after issuance.  Re-read the authoritative
 * rows on every request and reject stale tenant claims before setting `user`.
 * 同时供 WebSocket 升级鉴权（lib/ws-auth.ts）复用，保证 WS 与 HTTP 的主体校验口径一致。
 */
export async function checkAdminJwtSubject(payload: JwtPayload): Promise<AdminJwtCheck> {
  if (!Number.isInteger(payload.userId) || payload.userId <= 0) {
    return { ok: false, status: 401, message: '无效的访问令牌' };
  }
  const [row] = await db.select({
    username: users.username,
    status: users.status,
    tenantId: users.tenantId,
    tenantStatus: tenants.status,
    tenantExpireAt: tenants.expireAt,
  })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, payload.userId))
    .limit(1);
  if (!row) return { ok: false, status: 401, message: '用户不存在' };
  if (row.status !== 'enabled') return { ok: false, status: 403, message: '账号已被禁用' };

  const dbTenantId = row.tenantId ?? null;
  if ((payload.tenantId ?? null) !== dbTenantId) {
    return { ok: false, status: 401, message: '登录状态已失效，请重新登录' };
  }
  if (dbTenantId !== null && !isTenantActive({ status: row.tenantStatus, expireAt: row.tenantExpireAt })) {
    return { ok: false, status: 403, message: '租户已被禁用或过期' };
  }

  // A platform administrator may carry a temporary viewing tenant claim.  It
  // must be live as well; otherwise an old switched-tenant token survives a
  // tenant suspension even though the platform account itself is active.
  if (payload.viewingTenantId != null) {
    if (!isSuperAdmin(payload) || dbTenantId !== null || !Number.isInteger(payload.viewingTenantId) || payload.viewingTenantId <= 0) {
      return { ok: false, status: 401, message: '登录状态已失效，请重新登录' };
    }
    const [viewingTenant] = await db.select({ status: tenants.status, expireAt: tenants.expireAt })
      .from(tenants)
      .where(eq(tenants.id, payload.viewingTenantId))
      .limit(1);
    if (!viewingTenant) return { ok: false, status: 403, message: '租户不存在' };
    if (!isTenantActive(viewingTenant)) {
      return { ok: false, status: 403, message: '租户已被禁用或过期' };
    }
  }

  return {
    ok: true,
    payload: {
      ...payload,
      username: row.username,
      tenantId: dbTenantId,
    },
  };
}

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
    if (!row.user.tenant || !isTenantActive(row.user.tenant)) return null;
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
    const tokenType = (payload as { type?: string }).type;
    if (tokenType === 'member' || tokenType === 'refresh' || !Array.isArray(payload.roles)) {
      return c.json(errBody('无效的访问令牌', 401), 401);
    }

    const subject = await checkAdminJwtSubject(payload);
    if (!subject.ok) return c.json(errBody(subject.message, subject.status), subject.status);

    // Blacklist check + session touch are independent Redis ops — run in parallel
    // (each best-effort: Redis errors log a warning and never block the request)
    if (payload.jti) {
      const jti = payload.jti;
      const { blacklisted, touched } = await checkSessionLiveness(jti, { isBlacklisted: isTokenBlacklisted, touch: touchSession, logPrefix: '[Auth]' });
      if (blacklisted) {
        return c.json(errBody('会话已被强制下线', 401), 401);
      }
      // Session missing (e.g. Redis restarted) — lazily re-register to keep online-users list accurate
      // (best-effort: any failure here must not block the request)
      if (!touched) {
        try {
          const [u] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, subject.payload.userId)).limit(1);
          if (u) {
            registerSession({
              tokenId: jti,
              userId: subject.payload.userId,
              username: subject.payload.username,
              nickname: u.nickname,
              tenantId: subject.payload.tenantId ?? null,
              ...clientFingerprint(c),
              location: null,
              loginAt: new Date(),
            }).catch(() => { /* best-effort, ignore errors */ });
          }
        } catch (err) {
          logger.warn('[Auth] Session lazy re-register failed, allowing request:', err);
        }
      }
    }

    c.set('user', subject.payload);
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
