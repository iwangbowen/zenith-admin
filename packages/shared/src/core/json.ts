/**
 * 键序稳定的 JSON 序列化：对象键按 `localeCompare` 排序、数组保序、标量走 `JSON.stringify`。
 *
 * 用途：jsonb 回读会重排对象键序，直接 `JSON.stringify` 对比会误报变更；也用于对配置对象做内容指纹。
 * ⚠️ 排序规则被持久化指纹（如子流程实例键）依赖，不得改变。
 */
export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
}

/** 非 null、非数组的普通对象 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 按点分路径读取嵌套值（`data.items` / `result.list.0`），数组可用下标段访问；
 * 路径为空时返回原值，中途遇到非对象返回 `undefined`。
 * 用于外部 API 响应的 `itemsPath` 之类由配置指定的取数路径。
 */
export function getByPath(source: unknown, path: string | null | undefined): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>(
    (current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key.trim()] : undefined),
    source,
  );
}
