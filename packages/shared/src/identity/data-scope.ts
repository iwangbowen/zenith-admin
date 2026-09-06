import type { DataScope } from './constants';

/**
 * 数据权限范围的「宽松程度」排序：数值越大可见范围越广。
 * 用户最终有效范围 = 角色 / 用户组继承 / 用户直接指定 三者中最宽松者，服务端、前端展示与 Mock 共用同一口径。
 */
export const DATA_SCOPE_PRIORITY: Readonly<Record<DataScope, number>> = {
  all: 5,
  dept: 4,
  dept_only: 3,
  custom: 2,
  self: 1,
};

/** 取最宽松的数据权限范围；忽略 null / undefined，全部为空返回 null；未知取值按优先级 0 处理 */
export function mostPermissiveDataScope<T extends string>(scopes: ReadonlyArray<T | null | undefined>): T | null {
  const valid = scopes.filter((s): s is T => s != null);
  if (valid.length === 0) return null;
  const priorityOf = (scope: string): number => DATA_SCOPE_PRIORITY[scope as DataScope] ?? 0;
  return valid.reduce((best, curr) => (priorityOf(curr) > priorityOf(best) ? curr : best), valid[0]);
}
