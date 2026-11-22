import { HTTPException } from 'hono/http-exception';

export const PG_ERROR_CODES = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  /** ON DELETE RESTRICT 抛 23001，与 NO ACTION 的 23503 不同，删除保护需同时识别。 */
  restrictViolation: '23001',
} as const;

export function getPgErrorCode(error: unknown): string | undefined {
  // Drizzle 将底层 pg 错误包装为 DrizzleQueryError，真实错误码位于 cause 链上，
  // 故沿 cause 链向下查找第一个字符串型 code。
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isPgError(error: unknown, code: string): boolean {
  return getPgErrorCode(error) === code;
}

export function isPgUniqueViolation(error: unknown): boolean {
  return isPgError(error, PG_ERROR_CODES.uniqueViolation);
}

/** 外键引用冲突：NO ACTION 为 23503，RESTRICT 为 23001，两者语义相同。 */
export function isPgForeignKeyViolation(error: unknown): boolean {
  const code = getPgErrorCode(error);
  return code === PG_ERROR_CODES.foreignKeyViolation || code === PG_ERROR_CODES.restrictViolation;
}

/**
 * 沿 cause 链取出违反的约束名，用于区分同表多个唯一约束。
 * postgres.js 用 `constraint_name`，node-postgres 用 `constraint`，两者都兼容。
 */
export function getPgConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    const row = current as { constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof row.constraint_name === 'string') return row.constraint_name;
    if (typeof row.constraint === 'string') return row.constraint;
    current = row.cause;
  }
  return undefined;
}

/**
 * 将 PostgreSQL 唯一约束冲突映射为业务错误对象，其他错误原样返回（供需要 `throw` 表达式的调用方使用）。
 *
 * `byConstraint` 用于同一张表存在多个唯一约束时给出精准提示（命中约束名优先，
 * 未命中则回落到 `message`）。
 */
export function toPgUniqueViolationError(
  error: unknown,
  message: string,
  byConstraint?: Readonly<Record<string, string>>,
): unknown {
  if (isPgUniqueViolation(error)) {
    const constraint = getPgConstraintName(error);
    const specific = constraint ? byConstraint?.[constraint] : undefined;
    return new HTTPException(400, { message: specific ?? message });
  }
  return error;
}

/** `throw toPgUniqueViolationError(...)` 的语句形态 */
export function rethrowPgUniqueViolation(
  error: unknown,
  message: string,
  byConstraint?: Readonly<Record<string, string>>,
): never {
  throw toPgUniqueViolationError(error, message, byConstraint);
}