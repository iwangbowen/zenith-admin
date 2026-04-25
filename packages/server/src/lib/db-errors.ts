import { AppError } from './errors';

export const PG_ERROR_CODES = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
} as const;

export function getPgErrorCode(error: unknown): string | undefined {
  return (error as { code?: unknown } | null)?.code as string | undefined;
}

export function isPgError(error: unknown, code: string): boolean {
  return getPgErrorCode(error) === code;
}

export function isPgUniqueViolation(error: unknown): boolean {
  return isPgError(error, PG_ERROR_CODES.uniqueViolation);
}

/**
 * 将 PostgreSQL 唯一约束冲突统一映射为业务错误，其他错误原样抛出。
 */
export function rethrowPgUniqueViolation(error: unknown, message: string): never {
  if (isPgUniqueViolation(error)) throw new AppError(message, 400);
  throw error;
}