/**
 * 查询构造辅助函数单测（全局复用的 WHERE 合并 / LIKE 转义 / 分页）。
 *
 * 覆盖：
 *  1. escapeLike：%、_、\ 元字符转义（防 LIKE 通配符注入），转义顺序正确（先 \ 再 % _）
 *  2. mergeWhere：双条件 and 合并、单条件透传、全空返回 undefined
 *  3. withPagination：LIMIT/OFFSET 换算
 */
import { describe, it, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import { escapeLike, mergeWhere, withPagination } from './where-helpers';

describe('escapeLike - LIKE 注入防护', () => {
  it('% 被转义', () => {
    expect(escapeLike('100%')).toBe(String.raw`100\%`);
  });

  it('_ 被转义', () => {
    expect(escapeLike('user_name')).toBe(String.raw`user\_name`);
  });

  it('反斜杠被转义', () => {
    expect(escapeLike('a\\b')).toBe(String.raw`a\\b`);
  });

  it('先转义反斜杠再转义通配符（顺序关键，避免双重转义）', () => {
    // 输入 \% → 期望 \\\%（原 \ 转成 \\，原 % 转成 \%）
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('普通字符串原样返回', () => {
    expect(escapeLike('zhang san')).toBe('zhang san');
  });

  it('恶意全匹配 payload 被中和', () => {
    expect(escapeLike('%%%')).toBe(String.raw`\%\%\%`);
  });
});

describe('mergeWhere', () => {
  const a = sql`1 = 1`;
  const b = sql`2 = 2`;

  it('双条件返回 and 合并（新对象）', () => {
    const merged = mergeWhere(a, b);
    expect(merged).toBeDefined();
    expect(merged).not.toBe(a);
    expect(merged).not.toBe(b);
  });

  it('仅 base → 返回 base 本身', () => {
    expect(mergeWhere(a, undefined)).toBe(a);
  });

  it('仅 extra → 返回 extra 本身', () => {
    expect(mergeWhere(undefined, b)).toBe(b);
  });

  it('全空 → undefined（不加 WHERE）', () => {
    expect(mergeWhere(undefined, undefined)).toBeUndefined();
  });
});

describe('withPagination', () => {
  function fakeQb() {
    const qb = {
      limit: vi.fn(() => qb),
      offset: vi.fn(() => qb),
    };
    return qb;
  }

  it('page=1 → OFFSET 0', () => {
    const qb = fakeQb();
    withPagination(qb as unknown as PgSelect, 1, 10);
    expect(qb.limit).toHaveBeenCalledWith(10);
    expect(qb.offset).toHaveBeenCalledWith(0);
  });

  it('page=3, pageSize=20 → LIMIT 20 OFFSET 40', () => {
    const qb = fakeQb();
    withPagination(qb as unknown as PgSelect, 3, 20);
    expect(qb.limit).toHaveBeenCalledWith(20);
    expect(qb.offset).toHaveBeenCalledWith(40);
  });
});
