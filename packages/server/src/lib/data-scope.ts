import { eq, inArray, type SQL, type AnyColumn } from 'drizzle-orm';
import { db } from '../db';
import { roles, userRoles, users, departments } from '../db/schema';

export interface DataScopeOptions {
  /** 当前登录用户 ID */
  currentUserId: number;
  /**
   * 目标业务表中存放部门 ID 的列（如 orders.departmentId）。
   * dept 权限生效时用于过滤。
   * 若不传，dept 权限将降级为 self 处理。
   */
  deptColumn?: AnyColumn;
  /**
   * 目标业务表中标识数据归属人的列（如 orders.createdBy 或 users.id）。
   * self 权限生效时用于过滤。
   * 若不传，则对 self 权限不做过滤（不推荐）。
   */
  ownerColumn?: AnyColumn;
}

/**
 * 计算当前用户的数据权限过滤条件。
 *
 * 使用方式：
 * ```ts
 * const scopeWhere = await getDataScopeCondition({
 *   currentUserId,
 *   deptColumn: orders.departmentId,
 *   ownerColumn: orders.createdBy,
 * });
 * const where = scopeWhere ? and(baseCondition, scopeWhere) : baseCondition;
 * ```
 *
 * - 返回 `undefined`：当前用户有全量数据访问权限，不需要追加任何条件。
 * - 返回 SQL 条件：需要追加到 WHERE 子句。
 */
export async function getDataScopeCondition(options: DataScopeOptions): Promise<SQL | undefined> {
  const { currentUserId, deptColumn, ownerColumn } = options;

  // ── 1. 查询用户的所有角色及其 dataScope ──────────────────────────────────────
  const userRoleList = await db
    .select({ dataScope: roles.dataScope, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, currentUserId));

  // ── 2. 计算有效权限（多角色取最宽松原则）─────────────────────────────────────
  const isSuperAdmin = userRoleList.some((r) => r.code === 'super_admin');
  const scopeSet = new Set(userRoleList.map((r) => r.dataScope));

  if (isSuperAdmin || scopeSet.has('all')) {
    return undefined; // 全量访问，不追加条件
  }

  // ── 3. dept 权限：本部门及子部门 ─────────────────────────────────────────────
  if (scopeSet.has('dept') && deptColumn) {
    const [me] = await db
      .select({ departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, currentUserId))
      .limit(1);

    if (me?.departmentId) {
      // 递归获取当前部门及全部子部门 ID（内存中遍历，避免复杂 CTE）
      const allDepts = await db
        .select({ id: departments.id, parentId: departments.parentId })
        .from(departments);
      const deptIds = collectDescendants(allDepts, me.departmentId);
      return inArray(deptColumn, deptIds);
    }

    // 用户未分配部门：降级为 self
  }

  // ── 4. self 权限：仅本人数据 ──────────────────────────────────────────────────
  if (ownerColumn) {
    return eq(ownerColumn, currentUserId);
  }

  // ownerColumn 未传且无部门：返回 undefined（不过滤，降级为全量，需调用方自行决策）
  return undefined;
}

/**
 * 从部门平铺列表中，收集指定部门及其所有后代部门的 ID。
 */
function collectDescendants(
  allDepts: { id: number; parentId: number }[],
  rootId: number,
): number[] {
  const result: number[] = [rootId];
  const queue: number[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const dept of allDepts) {
      if (dept.parentId === current) {
        result.push(dept.id);
        queue.push(dept.id);
      }
    }
  }
  return result;
}
