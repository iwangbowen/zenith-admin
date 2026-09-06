/** 把数值限制在 [min, max]；非有限数（NaN / Infinity）按 min 处理 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * `part / total` 的百分比，四舍五入到 `digits` 位小数（默认 1 位：`Math.round(ratio * 1000) / 10`）。
 * `total <= 0` 或任一参数非有限数时返回 null，由调用方决定空值展示（`?? 0`）。
 */
export function percentOf(part: number, total: number, digits = 1): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  // 与历史写法 `Math.round(ratio * 1000) / 10` 逐字等价（单次乘法），保证浮点结果一致
  return Math.round((part / total) * 10 ** (digits + 2)) / 10 ** digits;
}

/** 正整数判定（ID 类字段的合法性口径） */
export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * 归一化 ID 列表：`Number()` 转换（接受数字字符串）、只保留正整数、去重并保持首次出现顺序。
 * 用于用户 / 部门 / 站点等 ID 数组的入参清洗。
 */
export function uniquePositiveInts(values: Iterable<unknown> | null | undefined): number[] {
  if (!values) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of values) {
    const n = Number(raw);
    if (!isPositiveInt(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
