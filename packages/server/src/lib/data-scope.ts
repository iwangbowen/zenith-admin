import { eq, inArray, or, type SQL, type AnyColumn } from 'drizzle-orm';
import { currentOperationPermissions } from './context';
import { db } from '../db';
import type { DbExecutor } from '../db/types';
import { departments } from '../db/schema';
import { getUserEffectiveAccess } from './permissions';

export interface DataScopeOptions {
  /** Reuse the caller's transaction instead of acquiring another pool connection. */
  executor?: DbExecutor;
  /** 当前登录用户 ID */
  currentUserId: number;
  /** 后台任务可显式指定能力；HTTP 请求默认使用已经通过门禁的操作权限。 */
  permissions?: readonly string[];
  /**
   * 目标业务表中存放部门 ID 的列（如 orders.departmentId）。
   * dept 权限生效时用于过滤。
   * 若不传，dept 权限将降级为 self 处理。
   */
  deptColumn?: AnyColumn;
  /**
   * 目标业务表中标识数据归属人的列（如 orders.createdBy 或 users.id）。
   * self 权限生效时用于过滤。
   * 受限数据范围无法构造条件时抛错，禁止省略条件后放行。
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
  const { currentUserId, deptColumn, ownerColumn, executor = db } = options;
  const permissionCodes = options.permissions ?? currentOperationPermissions();

  const access = await getUserEffectiveAccess(currentUserId, executor);
  const sources = access.sources.filter(source => permissionCodes.length
    ? source.permissionCodes.some(code => permissionCodes.includes(code))
    : source.kind === 'role' || source.kind === 'group');
  const scopeSet = new Set(sources.map(source => source.dataScope));
  if (access.userDataScope) scopeSet.add(access.userDataScope);

  if (access.superAdmin || scopeSet.has('all')) {
    return undefined; // 全量访问，不追加条件
  }

  const conditions: SQL[] = [];
  let includeSelf = scopeSet.has('self') || scopeSet.size === 0;
  if (scopeSet.has('dept')) {
    if (deptColumn && access.departmentId) {
      const allDepts = await executor.select({ id: departments.id, parentId: departments.parentId }).from(departments);
      conditions.push(inArray(deptColumn, collectDescendants(allDepts, access.departmentId)));
    } else includeSelf = true;
  }
  if (scopeSet.has('custom')) {
    const ids = [...new Set([
      ...sources.filter(source => source.dataScope === 'custom').flatMap(source => source.deptScopeIds),
      ...(access.userDataScope === 'custom' ? access.userDeptScopeIds : []),
    ])];
    if (deptColumn && ids.length) conditions.push(inArray(deptColumn, ids));
    else includeSelf = true;
  }
  if (scopeSet.has('dept_only')) {
    if (deptColumn && access.departmentId) conditions.push(eq(deptColumn, access.departmentId));
    else includeSelf = true;
  }
  if (includeSelf && ownerColumn) conditions.push(eq(ownerColumn, currentUserId));
  if (includeSelf && !ownerColumn) throw new Error('Restricted data scope requires an owner column');
  if (!conditions.length) throw new Error('Restricted data scope requires an owner column');
  return conditions.length === 1 ? conditions[0] : or(...conditions);
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
