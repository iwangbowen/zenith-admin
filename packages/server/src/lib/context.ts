/**
 * 基于 Hono 官方 `hono/context-storage` 的 AsyncLocalStorage 封装。
 *
 * 通过 `contextStorage()` 中间件（在 `src/index.ts` 全局挂载）后，
 * 任意同步/异步函数栈内都可用 `currentUser()` / `getCtx()` 获取当前请求上下文，
 * 无需再把 `c: Context` 或 `user: JwtPayload` 一路透传到辅助函数。
 *
 * 注意：既有显式传参的函数（如 `tenantCondition(table, user)`）继续可用，
 * 新代码可选择使用此处零参风格。
 */
import { getContext, tryGetContext } from 'hono/context-storage';
import { eq } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthEnv, JwtPayload } from '../middleware/auth';
import { db } from '../db';
import { users, departments } from '../db/schema';
import { getUserPermissions } from './permissions';

/** 从 DB 加载的完整用户详情（部门 + 岗位 + 角色），仅在需要时懒查询。 */
export interface CurrentUserDetail {
  /** 用户 ID */
  id: number;
  /** 用户名 */
  username: string;
  /** 昵称 */
  nickname: string;
  /** 所属部门（未分配时为 null） */
  department: { id: number; name: string; code: string; parentId: number } | null;
  /** 所属岗位列表 */
  positions: { id: number; name: string; code: string }[];
  /** 角色列表（含完整角色信息） */
  roles: { id: number; name: string; code: string; dataScope: string }[];
}

/**
 * 当前请求的 Hono Context 环境类型别名。
 * 定义来自 `middleware/auth.ts` 的 `AuthEnv`，此处重新导出供其他模块使用。
 */
export type AppEnv = AuthEnv;

const userOverrideStore = new AsyncLocalStorage<JwtPayload>();

/** 获取当前请求 Context；脱离请求作用域（例如 worker、定时任务）时会抛出。 */
export function getCtx() {
  return getContext<AppEnv>();
}

/** 获取已登录用户；若当前请求未走认证中间件（如匿名接口）返回 undefined。 */
export function currentUserOrNull(): JwtPayload | undefined {
  return userOverrideStore.getStore() ?? tryGetContext<AppEnv>()?.get('user');
}

/** 获取已登录用户；若不存在抛错（用于只在鉴权后调用的场景）。 */
export function currentUser(): JwtPayload {
  const u = currentUserOrNull();
  if (!u) {
    throw new Error('currentUser() called outside an authenticated request context');
  }
  return u;
}

/** 在请求上下文外以指定用户身份执行逻辑，供 worker / 定时任务复用依赖 currentUser() 的 service。 */
export function runWithCurrentUser<T>(user: JwtPayload, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(userOverrideStore.run(user, fn));
}

// ─── 链路关联 traceId（贯穿一次操作的作业/事件 fan-out，跨异步/跨实例/子流程串联）─────
const traceIdStore = new AsyncLocalStorage<string>();

/**
 * 当前操作的链路关联 ID。由请求中间件（每个 HTTP 请求一枚）或 worker 执行作业时
 * （继承作业自身 traceId）建立；脱离作用域时返回 undefined。
 * `enqueueJob` 与事件 outbox 会自动继承它，使一次操作的全部异步副作用共享同一 traceId。
 */
export function currentTraceId(): string | undefined {
  return traceIdStore.getStore();
}

/** 在给定 traceId 作用域内执行 fn：其内部新入队的作业/发射的事件都会继承该 traceId 形成链路。 */
export function runWithTraceId<T>(traceId: string, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(traceIdStore.run(traceId, fn));
}

/**
 * 在 Service 层写入"操作前实体快照"，用于审计日志 diff 展示。
 * 与 middleware/guard.ts 的 `setAuditBeforeData(c, data)` 等价，但无需透传 Context。
 * 仅在请求上下文内可用（未在请求栈中调用会静默忽略）。
 */
export function setAuditBefore(data: unknown): void {
  const ctx = tryGetContext<AppEnv>();
  if (!ctx) return;
  ctx.set('auditBeforeData', JSON.stringify(data));
}

/**
 * 在 Service/Route 层写入"操作后实体快照"，用于响应体 data 为 null
 * 但仍需要审计日志 diff 的场景（如成员分配、权限分配）。
 */
export function setAuditAfter(data: unknown): void {
  const ctx = tryGetContext<AppEnv>();
  if (!ctx) return;
  ctx.set('auditAfterData', JSON.stringify(data));
}

// ─── 快捷工具：无需 DB，直接从 JWT Payload 取 ─────────────────────────────────

/** 快捷获取当前登录用户 ID。 */
export function currentUserId(): number {
  return currentUser().userId;
}

/** 快捷获取当前登录用户的角色 code 数组（来自 JWT Payload）。 */
export function currentUserRoles(): string[] {
  return currentUser().roles;
}

/**
 * 判断当前登录用户是否拥有指定角色（任意一个匹配即返回 true）。
 * 基于 JWT Payload 中的 roles 字段，无需查询数据库。
 *
 * @example
 * if (hasRole('admin', 'editor')) { ... }
 */
export function hasRole(...codes: string[]): boolean {
  const userRoleCodes = currentUser().roles;
  return codes.some((code) => userRoleCodes.includes(code));
}

/**
 * 判断当前登录用户是否为平台超级管理员（拥有 `super_admin` 角色且归属平台，tenantId 为 null）。
 * 基于 JWT Payload，无需查询数据库。仅凭角色 code 判定会被租户自建同名角色伪造。
 */
export function isSuperAdmin(): boolean {
  const user = currentUser();
  return user.roles.includes('super_admin') && (user.tenantId ?? null) === null;
}

// ─── DB 懒查询：获取部门/岗位等 JWT 中未携带的信息 ────────────────────────────

/**
 * 获取当前登录用户的完整详情（部门、岗位、角色完整信息），通过 DB 懒查询。
 *
 * 每次调用均执行一次 DB 查询（RQB 单次请求）。
 * 若需在同一请求内多次访问，请在 Service 层自行缓存返回值：
 * ```ts
 * const detail = await currentUserDetail();
 * ```
 *
 * @throws 若用户不存在于数据库中（已被删除等异常情况）会返回 null。
 */
export async function currentUserDetail(): Promise<CurrentUserDetail | null> {
  const { userId } = currentUser();

  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, username: true, nickname: true, departmentId: true },
    with: {
      userPositions: {
        columns: {},
        with: { position: { columns: { id: true, name: true, code: true } } },
      },
      userRoles: {
        columns: {},
        with: { role: { columns: { id: true, name: true, code: true, dataScope: true } } },
      },
    },
  });

  if (!row) return null;

  let department: CurrentUserDetail['department'] = null;
  if (row.departmentId) {
    const dept = await db.query.departments.findFirst({
      where: eq(departments.id, row.departmentId),
      columns: { id: true, name: true, code: true, parentId: true },
    });
    department = dept ?? null;
  }

  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    department,
    positions: row.userPositions.map((up) => up.position),
    roles: row.userRoles.map((ur) => ur.role),
  };
}

/**
 * 判断当前登录用户是否属于指定部门（或其任意后代部门）。
 * 需要一次 DB 查询获取用户部门信息。
 *
 * @param departmentId 目标部门 ID
 * @param includeDescendants 是否包含子部门，默认 false（仅精确匹配本部门）
 */
export async function isInDepartment(departmentId: number, includeDescendants = false): Promise<boolean> {
  const detail = await currentUserDetail();
  if (!detail?.department) return false;
  if (detail.department.id === departmentId) return true;
  if (!includeDescendants) return false;

  // 递归向上检查父级链
  const { userId } = currentUser();
  const [userRow] = await db
    .select({ departmentId: users.departmentId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow?.departmentId) return false;

  // 获取所有部门，检查用户所在部门是否是目标部门的后代
  const allDepts = await db.query.departments.findMany({
    columns: { id: true, parentId: true },
  });

  const descendants = new Set<number>();
  const queue = [departmentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    descendants.add(current);
    for (const d of allDepts) {
      if (d.parentId === current && !descendants.has(d.id)) {
        queue.push(d.id);
      }
    }
  }

  return descendants.has(userRow.departmentId);
}

/**
 * 判断当前登录用户是否拥有指定岗位（任意一个匹配即返回 true）。
 * 需要一次 DB 查询获取用户岗位信息。
 *
 * @param codes 岗位 code 列表
 */
export async function hasPosition(...codes: string[]): Promise<boolean> {
  const detail = await currentUserDetail();
  if (!detail) return false;
  return detail.positions.some((p) => codes.includes(p.code));
}

// ─── 多租户快捷工具（无需 DB，直接从 JWT Payload 取） ─────────────────────────

/** 快捷获取当前登录用户所属租户 ID（`null` 表示平台超管，无租户归属）。 */
export function currentTenantId(): number | null {
  return currentUser().tenantId ?? null;
}

/**
 * 快捷获取超管切换视角时的目标租户 ID。
 * 普通用户或超管未切换视角时返回 `undefined`。
 */
export function currentViewingTenantId(): number | null | undefined {
  return currentUser().viewingTenantId;
}

/**
 * 获取当前生效的租户 ID（兼容超管切换视角场景）。
 *
 * - 超管切换到某租户视角时，返回 `viewingTenantId`
 * - 其他情况返回 `tenantId`（可能为 `null`，表示平台超管）
 *
 * 在多租户数据过滤时统一使用此函数，而不是直接读 `tenantId`：
 * ```ts
 * const tId = effectiveTenantId();
 * if (tId) where.push(eq(table.tenantId, tId));
 * ```
 */
export function effectiveTenantId(): number | null {
  const { tenantId, viewingTenantId } = currentUser();
  return viewingTenantId ?? tenantId ?? null;
}

// ─── 其他常用快捷工具 ─────────────────────────────────────────────────────────

/** 快捷获取当前登录用户的用户名。 */
export function currentUsername(): string {
  return currentUser().username;
}

/**
 * 判断当前请求是否已认证（有登录用户）。
 * 在匿名可访问接口中用于区分登录/未登录状态。
 *
 * ```ts
 * if (isAuthenticated()) {
 *   const uid = currentUserId();
 *   // 已登录用户专属逻辑
 * }
 * ```
 */
export function isAuthenticated(): boolean {
  return currentUserOrNull() !== undefined;
}

/**
 * 判断当前登录用户是否同时拥有**所有**指定角色（全匹配）。
 * 与 `hasRole`（任意匹配）互补。
 *
 * @example
 * if (hasAllRoles('admin', 'auditor')) {
 *   // 只有同时拥有 admin 和 auditor 角色才允许
 * }
 */
export function hasAllRoles(...codes: string[]): boolean {
  const userRoleCodes = currentUser().roles;
  return codes.every((code) => userRoleCodes.includes(code));
}

/**
 * 判断当前登录用户是否拥有指定菜单权限标识（任意一个匹配即返回 `true`）。
 * 通过 `permissions.ts` 的带缓存查询，同一用户 5 分钟内仅查一次数据库。
 *
 * 超管（`super_admin` 角色）始终返回 `true`，无需权限查询。
 *
 * @example
 * if (await hasPermission('system:user:delete')) {
 *   // 有删除用户权限才执行
 * }
 */
export async function hasPermission(...codes: string[]): Promise<boolean> {
  if (isSuperAdmin()) return true;
  const permissions = await getUserPermissions(currentUserId());
  return codes.some((code) => permissions.includes(code));
}
