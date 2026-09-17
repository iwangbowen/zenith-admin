import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { jwt, type JwtVariables } from 'hono/jwt';
import { getTokenRevocation, touchSession, registerSession } from '../lib/session-manager';
import { checkSessionLiveness, clientFingerprint, sessionRevokedBody } from '../lib/session-liveness';
import { db } from '../db';
import { impersonationSessions, tenants, userApiTokens, users } from '../db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import logger from '../lib/logger';
import { isSuperAdmin } from '../lib/permissions';
import { isTenantActive } from '../lib/tenant';
import { checkSubjectLiveness, loadSubjectRow, type SubjectRow } from '../lib/subject-liveness';
import { TtlCache } from '../lib/ttl-cache';
import { onInvalidate, onInvalidationReset } from '../lib/invalidation-bus';
import { impersonationWriteDenial } from '../lib/impersonation-guard';
import { tagMiddleware } from '../lib/route-facts';

export interface JwtPayload {
  userId: number;
  username: string;
  roles: string[];
  tenantId: number | null;
  /** 超管切换租户视角时，存放目标租户 ID */
  viewingTenantId?: number | null;
  /**
   * 模拟登录：本令牌的 userId / roles / tenantId 都是被模拟用户的，这里记录实际操作人。
   * 只在 `impersonation.service` 签发的短时 access token 上出现；不签发 refresh token，也不可被续签。
   */
  impersonation?: ImpersonationClaim;
  jti?: string;
  /**
   * 登录时服务端断言的 OS 展示值（自报优先、缺项回退 UA 解析，仅展示）。
   * 操作日志等逐请求展示在 UA 冻结歧义（Win10）时回退到它；签名防伪造，随令牌轮换更新。
   */
  os?: string;
  authType?: 'jwt' | 'apiToken';
  apiTokenId?: number;
}

export interface ImpersonationClaim {
  /** impersonation_sessions.id */
  id: number;
  byUserId: number;
  byUsername: string;
  /** true = 只读模拟：除结束模拟与退出外拒绝全部写请求 */
  readOnly: boolean;
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

// ─── 主体权威行的进程内副本 ──────────────────────────────────────────────────
/**
 * 每个已认证请求都要重读用户 / 租户权威行（见 checkAdminJwtSubject），它曾是全局中间件链上唯一未缓存的
 * 每请求 PG 查询：管理端一次冷加载并发十余个请求，就同时占用同样多的连接做同一条主键点查。
 *
 * - 失效以 `users` / `tenants` 表触发器经 `cache_invalidate` 总线广播为准（覆盖任何写路径、事务提交后投递、
 *   全部实例同时收到），TTL 只是 NOTIFY 不可用（pgBouncer 事务池、监听降级）时的兜底，取值与维护模式开关一致；
 * - 关闭 stale-while-revalidate：鉴权不能拿过期值放行，过期即同步回源；单飞让冷加载的并发请求只发一条查询；
 * - 缓存的是原始行而非判定结果：`expireAt` 到点在请求时求值，不受 TTL 影响；
 * - 用户禁用 / 删除 / 改密 / 降权与租户停用 / 到期本身还会吊销 jti（`revokeUserSessions` / `revokeTenantSessions`），
 *   黑名单检查不经本缓存，因此这些操作的「立即失效」不依赖 NOTIFY 时效。
 */
const SUBJECT_CACHE_TTL_MS = 5_000;

interface TenantLivenessRow {
  status: string;
  expireAt: Date | null;
}

/** userId → 用户行（含所属租户状态）；不存在的用户缓存为 null，避免伪造 / 已删除主体反复回源 */
const subjectRows = new TtlCache<number, SubjectRow | null>(SUBJECT_CACHE_TTL_MS, { staleWhileRevalidate: false });
/** tenantId → 租户行；仅供平台管理员「切换租户视角」声明的活性校验 */
const tenantRows = new TtlCache<number, TenantLivenessRow | null>(SUBJECT_CACHE_TTL_MS, { staleWhileRevalidate: false });

interface ImpersonationLivenessRow {
  tokenId: string;
  expiresAt: Date;
  endedAt: Date | null;
}

/** impersonation_sessions.id → 记录行；结束 / 强制结束时由 service 主动删除副本 */
const impersonationRows = new TtlCache<number, ImpersonationLivenessRow | null>(SUBJECT_CACHE_TTL_MS, { staleWhileRevalidate: false });

async function loadImpersonationRow(id: number): Promise<ImpersonationLivenessRow | null> {
  const [row] = await db.select({ tokenId: impersonationSessions.tokenId, expiresAt: impersonationSessions.expiresAt, endedAt: impersonationSessions.endedAt })
    .from(impersonationSessions)
    .where(eq(impersonationSessions.id, id))
    .limit(1);
  return row ?? null;
}

/** 模拟会话记录变更（结束 / 强制结束）后清掉进程内副本，让本实例立即拒绝该令牌 */
export function invalidateImpersonationSubject(id: number): void {
  impersonationRows.delete(id);
}

async function loadTenantRow(tenantId: number): Promise<TenantLivenessRow | null> {
  const [row] = await db.select({ status: tenants.status, expireAt: tenants.expireAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row ?? null;
}

// ─── API Token 主体副本 ──────────────────────────────────────────────────────
/**
 * `zat_` 令牌鉴权此前每请求都重新做 token → user → tenant → user_roles → roles 的关联查询，是 JWT 路径缓存后
 * 全局中间件链上仅剩的每请求 PG 查询；脚本 / 集成调用方高频且突发，同样会把同一条查询排进连接池几十次。
 *
 * - 副本只放令牌行本身与所属用户的角色码（tokenHash 键）；用户 / 租户活性复用上面的 subjectRows +
 *   checkSubjectLiveness，禁用 / 移出租户 / 租户停用的即时性与 JWT 路径完全一致（同一失效链路）；
 * - 令牌创建 / 删除 / 过期改写经 user_api_tokens 触发器广播（迁移 0016），副本无 id 反向索引，收到即整段清空；
 *   角色变更走管理端更新用户时同事务写 users 行 → users 广播，只改 user_roles 的路径在 TTL 内收敛；
 * - 缓存的是原始行：expiresAt 到点在请求时求值，不受 TTL 影响；不存在的 hash 也缓存为 null，防伪造令牌反复回源。
 */
interface ApiTokenRow {
  id: number;
  userId: number;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  /** 所属用户当前启用角色的 code */
  roles: string[];
}

const apiTokenRows = new TtlCache<string, ApiTokenRow | null>(SUBJECT_CACHE_TTL_MS, { staleWhileRevalidate: false });

async function loadApiTokenRow(tokenHash: string): Promise<ApiTokenRow | null> {
  const row = await db.query.userApiTokens.findFirst({
    where: eq(userApiTokens.tokenHash, tokenHash),
    columns: { id: true, userId: true, expiresAt: true, lastUsedAt: true },
    with: {
      user: {
        columns: {},
        with: {
          userRoles: {
            columns: {},
            with: { role: { columns: { code: true, status: true } } },
          },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    roles: row.user.userRoles.filter(({ role }) => role.status === 'enabled').map(({ role }) => role.code),
  };
}

/** 清空全部主体副本（监听重建 / 测试） */
export function resetAdminSubjectCache(): void {
  subjectRows.clear();
  tenantRows.clear();
  impersonationRows.clear();
  apiTokenRows.clear();
}

onInvalidate('users', (message) => {
  const userId = Number(message.key);
  if (Number.isInteger(userId) && userId > 0) subjectRows.delete(userId);
  else subjectRows.clear();
  // 令牌副本内嵌角色码、按 hash 键无用户反向索引；用户行改动即整段清空（TTL 本就只有 5s，代价可忽略）
  apiTokenRows.clear();
});
onInvalidate('user_api_tokens', () => apiTokenRows.clear());
// 用户副本按 userId 键、没有租户反向索引；租户行改动极少，整段清空即可
onInvalidate('tenants', resetAdminSubjectCache);
onInvalidationReset(resetAdminSubjectCache);

/**
 * JWT signature verification is not enough for a long-lived access token:
 * users and tenants can be disabled after issuance.  Re-read the authoritative
 * rows on every request and reject stale tenant claims before setting `user`.
 * 同时供 WebSocket 升级鉴权（lib/ws-auth.ts）复用，保证 WS 与 HTTP 的主体校验口径一致。
 * 权威行经进程内副本读取（见上），失效由 `cache_invalidate` 总线驱动。
 */
export async function checkAdminJwtSubject(payload: JwtPayload): Promise<AdminJwtCheck> {
  if (!Number.isInteger(payload.userId) || payload.userId <= 0) {
    return { ok: false, status: 401, message: '无效的访问令牌' };
  }
  const row = await subjectRows.get(payload.userId, () => loadSubjectRow(payload.userId));
  const verdict = checkSubjectLiveness(row, { claimedTenantId: payload.tenantId ?? null });
  if (!verdict.ok) return verdict;
  const dbTenantId = verdict.tenantId;

  // A platform administrator may carry a temporary viewing tenant claim.  It
  // must be live as well; otherwise an old switched-tenant token survives a
  // tenant suspension even though the platform account itself is active.
  if (payload.viewingTenantId != null) {
    if (!isSuperAdmin(payload) || dbTenantId !== null || !Number.isInteger(payload.viewingTenantId) || payload.viewingTenantId <= 0) {
      return { ok: false, status: 401, message: '登录状态已失效，请重新登录' };
    }
    const viewingTenantId = payload.viewingTenantId;
    const viewingTenant = await tenantRows.get(viewingTenantId, () => loadTenantRow(viewingTenantId));
    if (!viewingTenant) return { ok: false, status: 403, message: '租户不存在' };
    if (!isTenantActive(viewingTenant)) {
      return { ok: false, status: 403, message: '租户已被禁用或过期' };
    }
  }

  // 模拟会话：实际操作人（管理员）自身被禁用 / 删除时派生会话同步失效，不能比本人登录活得更久；
  // 记录行（已结束 / 已到期 / jti 不匹配）是 Redis 黑名单之外的权威兜底（Redis 重启后黑名单丢失也不会复活）
  if (payload.impersonation) {
    const { id, byUserId } = payload.impersonation;
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(byUserId) || byUserId <= 0 || byUserId === payload.userId) {
      return { ok: false, status: 401, message: '无效的访问令牌' };
    }
    const [operatorRow, record] = await Promise.all([
      subjectRows.get(byUserId, () => loadSubjectRow(byUserId)),
      impersonationRows.get(id, () => loadImpersonationRow(id)),
    ]);
    if (!checkSubjectLiveness(operatorRow).ok) return { ok: false, status: 401, message: '模拟会话已失效：操作者账号不可用' };
    if (!record || record.tokenId !== payload.jti || record.endedAt !== null || record.expiresAt <= new Date()) {
      return { ok: false, status: 401, message: '模拟会话已结束' };
    }
  }

  return {
    ok: true,
    payload: {
      ...payload,
      username: verdict.row.username,
      tenantId: dbTenantId,
    },
  };
}

/** 最近使用时间按 5 分钟节流回写：副本内先行推进，TTL 内的后续命中不再重复发起同一条 UPDATE */
function touchApiTokenLastUsed(token: ApiTokenRow): void {
  const now = new Date();
  const cutoff = new Date(now.getTime() - API_TOKEN_LAST_USED_THROTTLE_MS);
  if (token.lastUsedAt && token.lastUsedAt >= cutoff) return;
  token.lastUsedAt = now;
  db.update(userApiTokens)
    .set({ lastUsedAt: now })
    .where(and(
      eq(userApiTokens.id, token.id),
      or(isNull(userApiTokens.lastUsedAt), lt(userApiTokens.lastUsedAt, cutoff)),
    ))
    .catch((err) => logger.warn('[Auth] API token last-used update failed:', err));
}

async function authenticateApiToken(rawToken: string): Promise<JwtPayload | null> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const token = await apiTokenRows.get(tokenHash, () => loadApiTokenRow(tokenHash));
  if (!token) return null;
  if (token.expiresAt && token.expiresAt <= new Date()) return null;

  // 用户 / 租户活性与 JWT 路径同口径、同副本、同失效链路；API Token 没有租户声明，不做声明比对
  const subject = await subjectRows.get(token.userId, () => loadSubjectRow(token.userId));
  const verdict = checkSubjectLiveness(subject);
  if (!verdict.ok) return null;

  touchApiTokenLastUsed(token);
  return {
    userId: verdict.row.id,
    username: verdict.row.username,
    roles: token.roles,
    tenantId: verdict.tenantId,
    authType: 'apiToken',
    apiTokenId: token.id,
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

    // 模拟会话的写门禁：只读模式拒绝全部写请求，可操作模式仍禁止账号安全类操作
    if (subject.payload.impersonation) {
      const denial = impersonationWriteDenial(c.req.method, c.req.path, subject.payload.impersonation);
      if (denial) return c.json(errBody(denial, 403), 403);
    }

    // Revocation check + session touch are independent Redis ops — run in parallel
    // (each best-effort: Redis errors log a warning and never block the request)
    if (payload.jti) {
      const jti = payload.jti;
      const { revoked, touched } = await checkSessionLiveness(jti, { revocation: getTokenRevocation, touch: touchSession, logPrefix: '[Auth]' });
      if (revoked) {
        return c.json(sessionRevokedBody(revoked), 401);
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
              ...clientFingerprint(c, subject.payload.os),
              location: null,
              loginAt: new Date(),
              impersonatorId: subject.payload.impersonation?.byUserId ?? null,
              impersonatorName: subject.payload.impersonation?.byUsername ?? null,
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
// 自描述标记：装配好的 app 可沿 app.routes 读出哪些端点挂了认证（契约 access 与运行时一致性测试 / 权限矩阵）
tagMiddleware(authMiddleware, { kind: 'auth' });

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
