/**
 * 会员认证中间件（与管理员 authMiddleware 完全隔离）。
 *
 * 关键安全隔离：会员 JWT 的 payload 带 `type: 'member'`，本中间件强制校验该字段；
 * 同时管理员 authMiddleware 会拒绝带 `type: 'member'` 的 token，杜绝两套体系互窜。
 */
import { createMiddleware } from 'hono/factory';
import { jwt, type JwtVariables } from 'hono/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { isMemberTokenBlacklisted, touchMemberSession, registerMemberSession } from '../lib/member-session-manager';
import { checkSessionLiveness, clientFingerprint } from '../lib/session-liveness';
import { db } from '../db';
import { members, tenants } from '../db/schema';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import logger from '../lib/logger';
import { isTenantActive } from '../lib/tenant';

export interface MemberJwtPayload {
  memberId: number;
  /** 主标识（手机号 / 用户名 / 邮箱之一），用于日志展示 */
  identifier: string;
  /** 固定为 'member'，用于与管理员 token 严格区分 */
  type: 'member';
  tenantId: number | null;
  jti?: string;
}

/** Hono Env 类型——声明 Variables 中的 member 字段类型 */
export type MemberAuthEnv = {
  Variables: JwtVariables<MemberJwtPayload> & {
    member: MemberJwtPayload;
  };
};

const jwtMiddleware = jwt({
  secret: config.jwtSecret,
  alg: 'HS256',
});

type MemberJwtCheck =
  | { ok: true; payload: MemberJwtPayload; nickname: string }
  | { ok: false; status: 401 | 403; message: string };

/** Re-check the member and its tenant on every request; JWT claims are staleable. */
export async function checkMemberJwtSubject(payload: MemberJwtPayload): Promise<MemberJwtCheck> {
  if (!Number.isInteger(payload.memberId) || payload.memberId <= 0) {
    return { ok: false, status: 401, message: '无效的会员令牌' };
  }
  const [row] = await db.select({
    id: members.id,
    nickname: members.nickname,
    phone: members.phone,
    username: members.username,
    email: members.email,
    status: members.status,
    tenantId: members.tenantId,
    tenantStatus: tenants.status,
    tenantExpireAt: tenants.expireAt,
  })
    .from(members)
    .leftJoin(tenants, eq(members.tenantId, tenants.id))
    .where(and(eq(members.id, payload.memberId), isNull(members.deletedAt)))
    .limit(1);
  if (!row) return { ok: false, status: 401, message: '会员不存在' };
  if (row.status !== 'active') return { ok: false, status: 403, message: '账号不可用' };

  const dbTenantId = row.tenantId ?? null;
  if ((payload.tenantId ?? null) !== dbTenantId) {
    return { ok: false, status: 401, message: '登录状态已失效，请重新登录' };
  }
  if (dbTenantId !== null && !isTenantActive({ status: row.tenantStatus, expireAt: row.tenantExpireAt })) {
    return { ok: false, status: 403, message: '租户已被禁用或过期' };
  }

  const identifier = row.phone || row.username || row.email || `member-${row.id}`;
  return {
    ok: true,
    nickname: row.nickname,
    payload: { ...payload, identifier, tenantId: dbTenantId },
  };
}

export const memberAuthMiddleware = createMiddleware<MemberAuthEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return c.json(errBody('未登录', 401), 401);
  }

  try {
    await jwtMiddleware(c, async () => {});
    const payload = c.get('jwtPayload') as MemberJwtPayload;

    // 关键隔离：必须是会员 token（管理员 token 无 type='member'）
    if (payload.type !== 'member' || !payload.memberId) {
      return c.json(errBody('无效的会员令牌', 401), 401);
    }

    const subject = await checkMemberJwtSubject(payload);
    if (!subject.ok) return c.json(errBody(subject.message, subject.status), subject.status);

    // 黑名单检查与会话续期相互独立——并行执行（均 best-effort，Redis 故障不阻断请求）
    if (payload.jti) {
      const jti = payload.jti;
      const { blacklisted, touched } = await checkSessionLiveness(jti, { isBlacklisted: isMemberTokenBlacklisted, touch: touchMemberSession, logPrefix: '[MemberAuth]' });
      if (blacklisted) {
        return c.json(errBody('会话已被强制下线', 401), 401);
      }
      // 会话缺失（如 Redis 重启）——懒重注册保持在线列表准确（best-effort，失败不阻断请求）
      if (!touched) {
        try {
          if (subject.nickname) {
            registerMemberSession({
              tokenId: jti,
              memberId: subject.payload.memberId,
              identifier: subject.payload.identifier,
              nickname: subject.nickname,
              tenantId: subject.payload.tenantId ?? null,
              ...clientFingerprint(c),
              location: null,
              loginAt: new Date(),
            }).catch(() => { /* best-effort */ });
          }
        } catch (err) {
          logger.warn('[MemberAuth] Session lazy re-register failed, allowing request:', err);
        }
      }
    }

    c.set('member', subject.payload);
    await next();
  } catch (err) {
    logger.warn('[MemberAuth] JWT verification failed:', err);
    return c.json(errBody('登录已过期', 401), 401);
  }
});

/**
 * 全局 ContextVariableMap 扩展：让 c.get('member') 在所有会员路由处理器中类型安全访问。
 * 与 middleware/auth.ts 的 user/auditBeforeData 声明合并（declaration merging）。
 */
declare module 'hono' {
  interface ContextVariableMap {
    member: MemberJwtPayload;
  }
}
