/**
 * 启动期对账 SQL 的构造校验。
 *
 * 背景：`sql`col <> ALL(${jsArray})`` 会被编译成元组语法 `ALL(($1, $2))`，
 * 这在 PostgreSQL 中是语法错误。该错误发生在 `initCronScheduler()` 内，
 * 而 `declareBackgroundJobs()` 整块包在 try/catch 中，
 * 结果是「系统调度任务列表」与「任务中心类型列表」双双为空且无明显报错。
 *
 * 这里锁定两点：必须用 `notInArray`（生成合法的 `not in (...)`），
 * 以及空集合必须短路——`notInArray(col, [])` 求值为 `true`，直接用作
 * DELETE 条件会清空整表。
 */
import { describe, it, expect } from 'vitest';
import { sql, notInArray } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { cronJobs } from '../db/schema';

const dialect = new PgDialect();

describe('启动期对账条件', () => {
  it('notInArray 生成合法的 not in 列表', () => {
    const built = dialect.sqlToQuery(notInArray(cronJobs.handler, ['a', 'b']) as never);
    expect(built.sql).toContain('not in');
    expect(built.sql).not.toContain('ALL(');
    expect(built.params).toEqual(['a', 'b']);
  });

  it('裸 sql 的 <> ALL(数组) 会退化成元组语法（因此禁止使用）', () => {
    const built = dialect.sqlToQuery(sql`${cronJobs.handler} <> ALL(${['a', 'b']})` as never);
    // 元组而非数组：PostgreSQL 会直接报语法错误
    expect(built.sql).toContain('ALL(($1, $2))');
  });

  it('空集合的 notInArray 求值为 true，因此调用方必须短路', () => {
    const built = dialect.sqlToQuery(notInArray(cronJobs.handler, []) as never);
    expect(built.sql.trim()).toBe('true');
  });
});
