/**
 * 基于 Hono 官方 `hono/context-storage` 的 AsyncLocalStorage 封装。
 *
 * 通过 `contextStorage()` 中间件（在 `src/index.ts` 全局挂载）后，
 * 任意同步/异步函数栈内都可用 `currentUser()` / `getCtx()` 获取当前请求上下文，
 * 无需再把 `c: Context` 或 `user: JwtPayload` 一路透传到辅助函数。
 *
 * 显式传参的函数（如 `tenantCondition(table, user)`）与此处零参风格可混用。
 */
import { tryGetContext } from 'hono/context-storage';
import { eq } from 'drizzle-orm';
import type { Permission } from '@zenith/shared/core';
import { db } from '../db';
import { users, departments } from '../db/schema';
import { getUserPermissions } from './permissions';
import { clampAuditJson } from './audit-clamp';
import { normalizeAuditSubjects, type AuditSubjectRef, type NormalizedAuditSubjectRef } from './audit-subject';
import { currentUser, currentUserId, currentCmsOpenApiAccess, isSuperAdmin, type AppEnv } from './context/principal';

// Application context combines request identity with permission and directory queries.
export * from './context/principal';

/** 从 DB 加载的完整用户详情（部门 + 岗位 + 角色），仅在需要时懒查询。 */
export interface CurrentUserDetail {
  id: number;
  username: string;
  nickname: string;
  /** 所属部门（未分配时为 null） */
  department: { id: number; name: string; code: string; parentId: number } | null;
  positions: { id: number; name: string; code: string }[];
  /** 角色列表（含完整角色信息） */
  roles: { id: number; name: string; code: string; dataScope: string }[];
}

// ─── 链路关联 correlationId（贯穿一次操作的作业/事件 fan-out，跨异步/跨实例/子流程串联）─────
// 定义在零依赖的 trace-context.ts（logger 的 mixin 也要读，放这里会成 logger→context→db→logger 环）
export { currentCorrelationId, runWithCorrelationId, currentParentRef, runWithParentRef } from './trace-context';

/**
 * 在 Service 层写入"操作前实体快照"，用于审计日志 diff 展示。
 * 与 middleware/guard.ts 的 `setAuditBeforeData(c, data)` 等价，但无需透传 Context。
 * 仅在请求上下文内可用（未在请求栈中调用会静默忽略）。
 */
export function setAuditBefore(data: unknown): void {
  const ctx = tryGetContext<AppEnv>();
  if (!ctx) return;
  // 结构化裁剪：合法 JSON + UTF-8 字节硬上界，防实体快照（flowData、批量数组）无界膨胀
  ctx.set('auditBeforeData', clampAuditJson(data));
}

/**
 * 在 Service/Route 层写入"操作后实体快照"，用于响应体 data 为 null
 * 但仍需要审计日志 diff 的场景（如成员分配、权限分配）。
 */
export function setAuditAfter(data: unknown): void {
  const ctx = tryGetContext<AppEnv>();
  if (!ctx) return;
  ctx.set('auditAfterData', clampAuditJson(data));
}

/**
 * Attach one or more structured entity references to the current operation
 * audit record. The guard persists these refs in `operation_log_subjects`
 * after the operation log row is written. Calling this outside an HTTP request
 * is a no-op, matching setAuditBefore/setAuditAfter semantics.
 */
export function setAuditSubjects(subjects: readonly AuditSubjectRef[], tenantId: number | null): void {
  const ctx = tryGetContext<AppEnv>();
  if (!ctx) return;
  ctx.set('auditSubjects', normalizeAuditSubjects(subjects));
  ctx.set('auditTenantId', tenantId);
}

/** Add one structured entity reference to the current operation audit record. */
export function addAuditSubject(subject: AuditSubjectRef, tenantId: number | null): void {
  const ctx = tryGetContext<AppEnv>();
  if (!ctx) return;
  const current = ctx.get('auditSubjects') ?? [];
  if (current.length > 0 && ctx.get('auditTenantId') !== tenantId) {
    throw new Error('One operation audit cannot attach subjects from different tenants');
  }
  ctx.set('auditSubjects', normalizeAuditSubjects([...current, subject]));
  ctx.set('auditTenantId', tenantId);
}

/** Read the normalized refs attached to the current request, if any. */
export function currentAuditSubjects(): readonly NormalizedAuditSubjectRef[] {
  return tryGetContext<AppEnv>()?.get('auditSubjects') ?? [];
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
export async function hasPermission(...codes: Permission[]): Promise<boolean> {
  const openAccess = currentCmsOpenApiAccess();
  if (openAccess) return codes.some((code) => openAccess.permissions.includes(code));
  if (isSuperAdmin()) return true;
  const permissions = await getUserPermissions(currentUserId());
  return codes.some((code) => permissions.includes(code));
}
