import { isPositiveInt } from '@zenith/shared/core';

/**
 * 导出中心 query 归一化：导出任务的 query 是 `Record<string, unknown>`（来自页面筛选原样透传），
 * 各导出定义在映射为服务层查询参数前用这里的 helper 收窄类型，避免每个定义各写一份。
 */

/** 非空字符串（去首尾空白），空串 / 非字符串视为未填 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 正整数（接受数字或数字字符串），其余视为未填 */
export function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return isPositiveInt(n) ? n : undefined;
}

/** 布尔（接受 boolean 或 'true' / 'false' 字符串），其余视为未填 */
export function asBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}
