/**
 * 审计上下文：为写操作（insert/update）提供"当前操作人"。
 *
 * 优先级：
 *   1. `runAsUser(userId, fn)` 覆写（用于 seed、定时任务、系统脚本等非 HTTP 场景）
 *   2. 当前 Hono 请求上下文中的登录用户（`currentUserOrNull()`）
 *
 * 该值由 `db/index.ts` 的 Proxy 拦截写操作时统一注入到 `createdBy` / `updatedBy` 列，
 * 业务 service 无需手动赋值。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { currentUserOrNull } from './context';

const overrideStore = new AsyncLocalStorage<{ userId: number }>();

/** 在指定用户身份下执行 fn（覆盖请求上下文中的登录用户）。 */
export function runAsUser<T>(userId: number, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(overrideStore.run({ userId }, fn));
}

/** 取得当前应记入审计字段的用户 ID；无可用上下文时返回 null。 */
export function currentAuditUserId(): number | null {
  const override = overrideStore.getStore();
  if (override) return override.userId;
  try {
    return currentUserOrNull()?.userId ?? null;
  } catch {
    return null;
  }
}
