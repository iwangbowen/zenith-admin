/** Request identity only. This module must never import database or permission services. */
import { getContext, tryGetContext } from 'hono/context-storage';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthEnv, JwtPayload } from '../../middleware/auth';

/**
 * 当前请求的 Hono Context 环境类型别名。
 * 定义来自 `middleware/auth.ts` 的 `AuthEnv`，此处重新导出供其他模块使用。
 */
export type AppEnv = AuthEnv;

const userOverrideStore = new AsyncLocalStorage<JwtPayload>();
const operationPermissionStore = new AsyncLocalStorage<readonly string[]>();

export function currentOperationPermissions(): readonly string[] {
  return operationPermissionStore.getStore() ?? [];
}

export function runWithOperationPermissions<T>(permissions: readonly string[], fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(operationPermissionStore.run(permissions, fn));
}

/**
 * 开放 API 写入时的请求级授权上下文。
 *
 * 开放应用不是后台用户，不能通过伪造 `super_admin` 角色复用后台服务。服务层
 * 的站点、栏目和权限断言会优先读取这个上下文，因而每一层都保留同一条
 * `client -> site -> channel -> scope` 授权边界。
 */
export interface CmsOpenApiAccessContext {
  readonly clientId: string;
  readonly siteId: number;
  /** 空数组表示该站点全部栏目；非空时仅允许列出的栏目。 */
  readonly channelIds: readonly number[];
  /** 已由开放网关收窄后的 CMS 权限，而不是后台用户角色。 */
  readonly permissions: readonly string[];
}

const cmsOpenApiAccessStore = new AsyncLocalStorage<CmsOpenApiAccessContext>();

export function currentCmsOpenApiAccess(): CmsOpenApiAccessContext | undefined {
  return cmsOpenApiAccessStore.getStore();
}

export function runWithCmsOpenApiAccess<T>(
  access: CmsOpenApiAccessContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(cmsOpenApiAccessStore.run(access, fn));
}

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
  // 开放 API 使用独立 principal，即使外层存在后台请求上下文也不能借用超管权限。
  if (currentCmsOpenApiAccess()) return false;
  const user = currentUser();
  return user.roles.includes('super_admin') && (user.tenantId ?? null) === null;
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
