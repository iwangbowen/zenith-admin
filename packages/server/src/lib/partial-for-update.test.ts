/**
 * `partialForUpdate()` 是全部 update schema 的唯一派生入口（ESLint 封禁直接 `.partial()`），
 * 这里锁定它的核心契约：字段省略时不得出现任何默认值，且非默认值的包装原样保留。
 * 契约层的端到端校验见 app.contract.test.ts「部分更新契约」。
 */
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { partialForUpdate } from '@zenith/shared/core';

const createSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['directory', 'menu']).default('menu'),
  parentId: z.coerce.number().int().default(0),
  tagIds: z.array(z.number()).default([]),
  optionalWithDefault: z.string().default('A').optional(),
  nullableWithDefault: z.string().default('B').nullable(),
  defaultOverNullable: z.string().nullable().default('C'),
  stacked: z.string().default('x').default('y'),
  prefaulted: z.string().prefault('P'),
  piped: z.string().default('D').transform((value) => value.toLowerCase()),
  readonlyWithDefault: z.array(z.string()).default([]).readonly(),
});

const updateSchema = partialForUpdate(createSchema);

describe('partialForUpdate', () => {
  it('空对象解析后不得凭空多出任何字段', () => {
    expect(updateSchema.parse({})).toEqual({});
  });

  it('只回传显式提交的字段', () => {
    expect(updateSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(updateSchema.parse({ type: 'directory' })).toEqual({ type: 'directory' });
  });

  it('剥离嵌套在 optional / nullable / pipe / readonly 内的默认值', () => {
    const parsed = updateSchema.parse({ title: 'x' });
    expect(parsed).not.toHaveProperty('optionalWithDefault');
    expect(parsed).not.toHaveProperty('nullableWithDefault');
    expect(parsed).not.toHaveProperty('piped');
    expect(parsed).not.toHaveProperty('readonlyWithDefault');
  });

  it('保留 nullable：显式传 null 仍是合法的「清空」', () => {
    expect(updateSchema.parse({ nullableWithDefault: null })).toEqual({ nullableWithDefault: null });
    expect(updateSchema.parse({ defaultOverNullable: null })).toEqual({ defaultOverNullable: null });
  });

  it('保留 pipe：显式提交时 transform 仍然执行', () => {
    expect(updateSchema.parse({ piped: 'ABC' })).toEqual({ piped: 'abc' });
  });

  it('保留 readonly 包装', () => {
    const parsed = updateSchema.parse({ readonlyWithDefault: ['a'] });
    expect(Object.isFrozen(parsed.readonlyWithDefault)).toBe(true);
  });

  it('保留字段本身的校验规则', () => {
    expect(updateSchema.safeParse({ title: '' }).success).toBe(false);
    expect(updateSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('可继续链式 extend / superRefine', () => {
    const withLock = updateSchema.extend({ expectedRevision: z.number().int().positive() });
    expect(withLock.parse({ expectedRevision: 3 })).toEqual({ expectedRevision: 3 });
    expect(withLock.safeParse({}).success).toBe(false);
  });

  it('不改变 create schema 自身的默认值', () => {
    expect(createSchema.parse({ title: 'x' })).toMatchObject({ type: 'menu', parentId: 0, tagIds: [] });
  });
});
