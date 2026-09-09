import type { SQL, SQLWrapper } from 'drizzle-orm';
import { eq, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { config } from '../config';
import type { JwtPayload } from '../middleware/auth';
import { nullableEq } from './where-helpers';

const SUPER_ADMIN_CODE = 'super_admin';

/** 租户是否已到期：`expireAt <= now`，与 tenant-lifecycle 的到期扫描口径一致 */
export function isTenantExpired(tenant: { expireAt: Date | null | undefined }, now = new Date()): boolean {
  return tenant.expireAt != null && tenant.expireAt <= now;
}

/** 租户是否可用：状态为 enabled 且未到期。所有登录 / 续签 / 令牌校验路径统一以此判定 */
export function isTenantActive(
  tenant: { status: string | null | undefined; expireAt: Date | null | undefined },
  now = new Date(),
): boolean {
  return tenant.status === 'enabled' && !isTenantExpired(tenant, now);
}
/** Check if the current user is a platform super admin (tenantId is null) */
export function isPlatformAdmin(user: JwtPayload): boolean {
  return user.roles.includes(SUPER_ADMIN_CODE) && user.tenantId === null;
}

/** Get the effective tenant ID (viewingTenantId takes priority for super admin) */
export function getEffectiveTenantId(user: JwtPayload): number | null {
  if (!config.multiTenantMode) return null;
  if (isPlatformAdmin(user) && user.viewingTenantId !== undefined) {
    return user.viewingTenantId;
  }
  return user.tenantId;
}

/**
 * Return the concrete tenant scope for data operations.
 *
 * Platform super-admins use both an omitted `viewingTenantId` (fresh login)
 * and an explicit `null` (the switch-tenant endpoint's "platform view") to
 * mean "all tenants"; both therefore return `undefined`. A concrete number
 * means that tenant view. For non-platform users, `null` remains the explicit
 * tenant-less/global scope.
 */
export function getTenantScopeId(user: JwtPayload): number | null | undefined {
  if (!config.multiTenantMode) return undefined;
  if (isPlatformAdmin(user)) return user.viewingTenantId ?? undefined;
  return user.tenantId ?? null;
}

/** Write operations must never silently choose the global scope for a platform
 * administrator in the all-tenant platform view. The caller may pass an
 * explicit override for scheduled jobs or other trusted system flows. */
export function requireTenantScopeId(user: JwtPayload): number | null {
  const scope = getTenantScopeId(user);
  if (scope === undefined && config.multiTenantMode) {
    throw new HTTPException(400, { message: '请先选择租户视角后再执行该资金操作' });
  }
  return scope ?? null;
}

/**
 * Build a tenant filter condition for queries.
 * - Multi-tenant off → no filter
 * - Platform admin without viewingTenantId → no filter (sees all)
 * - Platform admin with viewingTenantId → filter by that tenant
 * - Normal user → filter by their tenantId
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tenantCondition<T extends { tenantId: any }>(
  table: T,
  user: JwtPayload,
): SQL | undefined {
  if (!config.multiTenantMode) return undefined;

  const effectiveTenantId = getEffectiveTenantId(user);

  // Platform admin sees all when not viewing a specific tenant
  if (isPlatformAdmin(user) && effectiveTenantId === null) {
    return undefined;
  }

  // Filter by tenant
  if (effectiveTenantId === null) {
    return isNull(table.tenantId);
  }
  return eq(table.tenantId, effectiveTenantId);
}

/**
 * Get the tenant ID to assign when creating records.
 * Returns the effective tenant ID for the current user.
 */
export function getCreateTenantId(user: JwtPayload): number | null {
  if (!config.multiTenantMode) return null;
  return getEffectiveTenantId(user);
}

// ─── 行到行的租户归属匹配 ────────────────────────────────────────────────────
// `tenantCondition` 表达的是「请求用户能看到什么」（平台管理员可看全部）；下面三个表达的是
// 「与一条已知归属（订单 / 应用 / 事件所属租户）做精确匹配」，两者语义不同、不可互换。

/** 精确匹配已知租户归属：`null` → `IS NULL`，数字 → `=` */
export function exactTenantCondition(column: SQLWrapper, tenantId: number | null): SQL {
  return nullableEq(column, tenantId ?? null);
}

/** `exactTenantCondition` 的可选形态：`undefined` 表示不按租户过滤 */
export function optionalExactTenantCondition(column: SQLWrapper, tenantId: number | null | undefined): SQL | undefined {
  return tenantId === undefined ? undefined : exactTenantCondition(column, tenantId);
}

/** 平台级记录可被租户继承：`null` → `IS NULL`，数字 → `IS NULL OR = tenantId` */
export function inheritedTenantCondition(column: SQLWrapper, tenantId: number | null): SQL {
  return tenantId == null ? isNull(column) : or(isNull(column), eq(column, tenantId))!;
}

// ─── 零参便捷重载：依赖 `contextStorage()` 中间件 ─────────────────────────
// 新代码可直接写 `tenantScope(table)`、`currentCreateTenantId()`，无需手动传 user。
// 既有显式传参 API 保持不变。

// 延迟导入避免循环：context.ts 依赖 middleware/auth 的类型，无运行时依赖
import { currentUser } from './context';

/** `tenantCondition` 的零参版本：自动读取当前请求用户。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tenantScope<T extends { tenantId: any }>(table: T): SQL | undefined {
  return tenantCondition(table, currentUser());
}

/** `getCreateTenantId` 的零参版本：自动读取当前请求用户。 */
export function currentCreateTenantId(): number | null {
  return getCreateTenantId(currentUser());
}

/**
 * 解析「平台 / 租户两级配置记录」（企业身份源、通讯录同步源等）写入时的目标租户。
 *
 * - 平台管理员可显式指定归属（含 `null` = 平台级）；未指定时落到当前视角；
 * - 其他用户一律强制落到自身租户，显式传入与自身不一致的值直接 403 —— 请求体里的
 *   `tenantId` 只是平台管理员的选择项，不能成为租户侧越权到平台级 / 他租户的入口。
 */
export function resolveManagedTenantId(
  requested: number | null | undefined,
  message = '无权为其他租户或平台配置该资源',
): number | null {
  const user = currentUser();
  if (isPlatformAdmin(user)) {
    return requested === undefined ? getCreateTenantId(user) : requested;
  }
  const own = getCreateTenantId(user);
  if (requested !== undefined && requested !== own) {
    throw new HTTPException(403, { message });
  }
  return own;
}

/**
 * 从同 key 的「平台级 / 租户级」多候选行中选出对当前租户生效的一行
 * （规则引擎决策表 / 决策流 / 评分卡等按 key 覆盖的配置）：
 * 租户精确匹配优先，其次回退平台级（`tenantId` 为 null）；
 * `tenantId` 为 `undefined`（无租户上下文：会员 / 定时任务）且仅剩单一候选时兼容使用（单租户历史数据）。
 */
export function pickTenantScopedRow<T extends { tenantId: number | null }>(candidates: readonly T[], tenantId: number | null | undefined): T | null {
  if (tenantId != null) {
    const exact = candidates.find((r) => r.tenantId === tenantId);
    if (exact) return exact;
  }
  const global = candidates.find((r) => r.tenantId == null);
  if (global) return global;
  return tenantId === undefined && candidates.length === 1 ? candidates[0] : null;
}
