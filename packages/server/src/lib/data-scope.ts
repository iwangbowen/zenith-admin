import { eq, inArray, type SQL, type AnyColumn } from 'drizzle-orm';
import { db } from '../db';
import { users, departments } from '../db/schema';

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

  // ── 1. 查询用户的角色（含 dataScope 和 deptScopes）及部门，合并为单次 RQB 请求 ──────────────
  const userData = await db.query.users.findFirst({
    where: eq(users.id, currentUserId),
    columns: { departmentId: true, userDataScope: true },
    with: {
      userRoles: {
        columns: {},
        with: {
          role: {
            columns: { dataScope: true, code: true, tenantId: true, status: true },
            with: { deptScopes: { columns: { deptId: true } } },
          },
        },
      },
      // 用户组绑定的角色：组内成员继承其数据权限（仅启用状态的组生效）
      userGroupMembers: {
        columns: {},
        with: {
          group: {
            columns: { status: true },
            with: {
              groupRoles: {
                columns: {},
                with: {
                  role: {
                    columns: { dataScope: true, code: true, tenantId: true, status: true },
                    with: { deptScopes: { columns: { deptId: true } } },
                  },
                },
              },
            },
          },
        },
      },
      userDeptScopes: { columns: { deptId: true } },
    },
  });
  // 禁用角色的数据权限不再生效（与功能权限解析同一口径）
  const directRoleList = (userData?.userRoles.map((ur) => ur.role) ?? []).filter((r) => r.status === 'enabled');
  const groupRoleList = (userData?.userGroupMembers ?? [])
    .filter(({ group }) => group.status === 'enabled')
    .flatMap(({ group }) => group.groupRoles.map((gr) => gr.role))
    .filter((r) => r.status === 'enabled');
  const userRoleList = [...directRoleList, ...groupRoleList];
  const userDirectScope = userData?.userDataScope ?? null;

  // ── 2. 计算有效权限（多角色 + 用户直接权限取最宽松原则）─────────────────────────────────────
  // 平台超管须双条件判定（code + 平台角色），防止租户自建 super_admin 伪造全量数据权限
  const isSuperAdmin = userRoleList.some((r) => r.code === 'super_admin' && r.tenantId === null);
  const scopeSet = new Set(userRoleList.map((r) => r.dataScope));
  if (userDirectScope !== null) scopeSet.add(userDirectScope);

  if (isSuperAdmin || scopeSet.has('all')) {
    return undefined; // 全量访问，不追加条件
  }

  // ── 3. dept 权限：本部门及子部门 ─────────────────────────────────────────────
  if (scopeSet.has('dept') && deptColumn) {
    if (userData?.departmentId) {
      // 递归获取当前部门及全部子部门 ID（内存中遍历，避免复杂 CTE）
      const allDepts = await db
        .select({ id: departments.id, parentId: departments.parentId })
        .from(departments);
      const deptIds = collectDescendants(allDepts, userData.departmentId);
      return inArray(deptColumn, deptIds);
    }

    // 用户未分配部门：降级为 self
  }

  // ── 4. custom 权限：指定部门 ──────────────────────────────────────────────────
  if (scopeSet.has('custom') && deptColumn) {
    const roleScopedDeptIds = userRoleList
      .filter((r) => r.dataScope === 'custom')
      .flatMap((r) => (r.deptScopes ?? []).map((ds) => ds.deptId));
    const userScopedDeptIds = userDirectScope === 'custom'
      ? (userData?.userDeptScopes?.map((ds) => ds.deptId) ?? [])
      : [];
    const uniqueDeptIds = [...new Set([...roleScopedDeptIds, ...userScopedDeptIds])];
    if (uniqueDeptIds.length > 0) {
      return inArray(deptColumn, uniqueDeptIds);
    }
    // 未配置指定部门：降级为 self
  }

  // ── 5. dept_only 权限：仅本部门（不含子部门） ─────────────────────────────────
  if (scopeSet.has('dept_only') && deptColumn) {
    if (userData?.departmentId) {
      return eq(deptColumn, userData.departmentId);
    }
    // 用户未分配部门：降级为 self
  }

  // ── 6. self 权限：仅本人数据 ──────────────────────────────────────────────────
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
