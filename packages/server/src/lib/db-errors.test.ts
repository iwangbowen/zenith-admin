/**
 * PostgreSQL 错误码提取与唯一约束映射单测（全服务复用，纯函数）。
 *
 * 覆盖：cause 链上错误码提取（Drizzle 包装场景）、深度上限、
 * isPgUniqueViolation 判定、rethrowPgUniqueViolation 映射为 400 / 透传其他错误。
 */
import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import {
  PG_ERROR_CODES,
  getPgErrorCode,
  isPgError,
  isPgUniqueViolation,
  rethrowPgUniqueViolation,
} from './db-errors';

describe('getPgErrorCode', () => {
  it('直接携带 code 的错误', () => {
    expect(getPgErrorCode({ code: '23505' })).toBe('23505');
  });

  it('Drizzle 包装：code 位于 cause 链第 2 层', () => {
    const err = { message: 'DrizzleQueryError', cause: { code: '23505' } };
    expect(getPgErrorCode(err)).toBe('23505');
  });

  it('多层 cause 链向下查找', () => {
    const err = { cause: { cause: { cause: { code: '23503' } } } };
    expect(getPgErrorCode(err)).toBe('23503');
  });

  it('深度上限 5：超深链返回 undefined（防御环形引用）', () => {
    const deep = { cause: { cause: { cause: { cause: { cause: { code: '23505' } } } } } };
    expect(getPgErrorCode(deep)).toBeUndefined();
  });

  it('非字符串 code 跳过并继续向下', () => {
    const err = { code: 42, cause: { code: '23505' } };
    expect(getPgErrorCode(err)).toBe('23505');
  });

  it('null / undefined / 无 code → undefined', () => {
    expect(getPgErrorCode(null)).toBeUndefined();
    expect(getPgErrorCode(undefined)).toBeUndefined();
    expect(getPgErrorCode(new Error('plain'))).toBeUndefined();
  });
});

describe('isPgError / isPgUniqueViolation', () => {
  it('匹配指定错误码', () => {
    expect(isPgError({ code: '23503' }, PG_ERROR_CODES.foreignKeyViolation)).toBe(true);
    expect(isPgError({ code: '23503' }, PG_ERROR_CODES.uniqueViolation)).toBe(false);
  });

  it('唯一约束冲突判定', () => {
    expect(isPgUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPgUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isPgUniqueViolation({ code: '23503' })).toBe(false);
    expect(isPgUniqueViolation(new Error('x'))).toBe(false);
  });
});

describe('rethrowPgUniqueViolation', () => {
  it('唯一约束冲突 → HTTPException 400 携带业务消息', () => {
    const pgErr = { cause: { code: '23505' } };
    try {
      rethrowPgUniqueViolation(pgErr, '用户名已存在');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      expect((err as HTTPException).status).toBe(400);
      expect((err as HTTPException).message).toBe('用户名已存在');
    }
  });

  it('非唯一约束错误原样透传（同一实例）', () => {
    const original = new Error('connection refused');
    try {
      rethrowPgUniqueViolation(original, '不应使用此消息');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBe(original);
    }
  });

  it('外键冲突不映射为 400（原样抛出）', () => {
    const fkErr = { code: '23503', message: 'fk violation' };
    try {
      rethrowPgUniqueViolation(fkErr, '不应使用此消息');
      expect.unreachable('应当抛出异常');
    } catch (err) {
      expect(err).toBe(fkErr);
      expect(err).not.toBeInstanceOf(HTTPException);
    }
  });
});
