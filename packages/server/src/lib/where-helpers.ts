import { and } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** 合并两个可选的 WHERE 条件，等价于 `base && extra ? and(base, extra) : (extra ?? base)` */
export function mergeWhere(base?: SQL, extra?: SQL): SQL | undefined {
  if (base && extra) return and(base, extra);
  return extra ?? base;
}

/** 转义 PostgreSQL LIKE / ILIKE 元字符（%, _, \），防止用户输入被解释为通配符 */
export function escapeLike(s: string): string {
  return s.replaceAll(String.raw`%`, String.raw`\%`).replaceAll('_', String.raw`\_`).replaceAll('\\', String.raw`\\`);
}
