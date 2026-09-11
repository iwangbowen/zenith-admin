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
import { TtlCache } from '../lib/ttl-cache';
import { onInvalidate, onInvalidationReset } from '../lib/invalidation-bus';

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

// ─── 主体权威行的进程内副本 ──────────────────────────────────────────────────
/**
 * 与管理员侧 `middleware/auth.ts` 的 `subjectRows` 同构：会员每个已认证请求（含 CMS 前台带会员 token 的页面请求）
 * 都要重读会员 / 所属租户权威行，此前是会员请求链上唯一未缓存的每请求 PG 查询。
 *
 * - 失效以 `members` / `tenants` 表触发器经 `cache_invalidate` 总线广播为准
 *   （迁移 `0010_member_subject_cache_invalidate.sql`），TTL 只是 NOTIFY 不可用时的兜底；
 * - 关闭 stale-while-revalidate：鉴权不能拿过期值放行，过期即同步回源；单飞让并发未命中只发一条查询；
 * - 缓存的是原始行：租户 `expireAt` 到点在请求时求值，不受 TTL 影响；
 * - 封禁 / 删除 / 改密本身还会吊销 `jti`，黑名单检查不经本缓存，这些操作的「立即失效」不依赖 NOTIFY 时效。
 */
const SUBJECT_CACHE_TTL_MS = 5_000;

async function loadSubjectRow(memberId: number) {
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
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)))
    .limit(1);
  return row ?? null;
}

type MemberSubjectRow = NonNullable<Awaited<ReturnType<typeof loadSubjectRow>>>;

/** memberId → 会员行（含所属租户状态）；不存在 / 已删除的会员缓存为 null，避免伪造主体反复回源 */
const subjectRows = new TtlCache<number, MemberSubjectRow | null>(SUBJECT_CACHE_TTL_MS, { staleWhileRevalidate: false });

/** 清空全部会员主体副本（监听重建 / 测试） */
export function resetMemberSubjectCache(): void {
  subjectRows.clear();
}

onInvalidate('members', (message) => {
  const memberId = Number(message.key);
  if (Number.isInteger(memberId) && memberId > 0) subjectRows.delete(memberId);
  else subjectRows.clear();
});
// 会员副本按 memberId 键、没有租户反向索引；租户行改动极少，整段清空即可
onInvalidate('tenants', resetMemberSubjectCache);
onInvalidationReset(resetMemberSubjectCache);

/**
 * Re-check the member and its tenant on every request; JWT claims are staleable.
 * 权威行经进程内副本读取（见上），失效由 `cache_invalidate` 总线驱动。
 */
export async function checkMemberJwtSubject(payload: MemberJwtPayload): Promise<MemberJwtCheck> {
  if (!Number.isInteger(payload.memberId) || payload.memberId <= 0) {
    return { ok: false, status: 401, message: '无效的会员令牌' };
  }
  const row = await subjectRows.get(payload.memberId, () => loadSubjectRow(payload.memberId));
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
