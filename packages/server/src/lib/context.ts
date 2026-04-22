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
import type { AuthEnv, JwtPayload } from '../middleware/auth';

/**
 * 当前请求的 Hono Context 环境类型别名。
 * 定义来自 `middleware/auth.ts` 的 `AuthEnv`，此处重新导出供其他模块使用。
 */
export type AppEnv = AuthEnv;

/** 获取当前请求 Context；脱离请求作用域（例如 worker、定时任务）时会抛出。 */
export function getCtx() {
  return getContext<AppEnv>();
}

/** 获取已登录用户；若当前请求未走认证中间件（如匿名接口）返回 undefined。 */
export function currentUserOrNull(): JwtPayload | undefined {
  return tryGetContext<AppEnv>()?.get('user');
}

/** 获取已登录用户；若不存在抛错（用于只在鉴权后调用的场景）。 */
export function currentUser(): JwtPayload {
  const u = currentUserOrNull();
  if (!u) {
    throw new Error('currentUser() called outside an authenticated request context');
  }
  return u;
}
